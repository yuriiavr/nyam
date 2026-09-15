-- ============================================================================
--  Ням — будильник готування, який надсилає сервер.
--
--  Виконувати в Supabase → SQL Editor після push.sql. Скрипт ідемпотентний.
--
--  Змінився цей файл — виконай його ще раз, і ДО деплою коду: маршрут
--  розсилки вже просить колонки, яких стара версія не мала (endpoint), і без
--  них відповідає 502, не забираючи будильників. Повторний запуск дописує
--  колонку, переписує функції й перевстановлює розклад за назвами.
--
--  Навіщо. На iPhone застосунок з екрана «Домів», щойно його згорнули,
--  заморожується, і таймер на сторінці готування не доживає до нуля: дзвонить
--  лише тоді, коли застосунок відкрили знову, тобто коли вже пізно. Пуш із
--  сервера приходить і в закритий застосунок. Тому таймер, запускаючись,
--  записує сюди «коли дзвонити», а база в потрібну секунду кличе
--  /api/push/timers, який і надсилає сповіщення.
--
--  Хто кличе. pg_cron раз на 5 секунд запускає dispatch_timer_pushes(). Розклад
--  Vercel тут не годиться: частіше ніж раз на хвилину він не вміє. Секундні
--  розклади pg_cron підтримує з версії 1.5 (Supabase: Postgres 15.1.1.61+).
--  Сама функція майже завжди нічого не робить — лише дивиться в індекс; запит
--  назовні йде тільки тоді, коли якийсь будильник справді настав.
--
--  ПЕРЕД ЗАПУСКОМ — два секрети у Vault (один раз; справжні значення в цей
--  файл не пишемо — він лежить у репозиторії):
--
--    select vault.create_secret('https://<твій-домен>', 'nyam_site_url');
--    select vault.create_secret('<значення PUSH_SECRET із Vercel>', 'nyam_push_secret');
--
--  Змінити секрет потім:
--
--    select vault.update_secret(
--      (select id from vault.secrets where name = 'nyam_push_secret'),
--      '<нове значення>'
--    );
--
--  Без секретів нічого не зламається — будильник просто не прийде з сервера,
--  а в журналі Postgres зʼявиться попередження.
--
--  Чому не дзвонить — дивитись тут (відповідь маршруту: claimed, sent, failed
--  зі статусами служби пуша):
--
--    select created, status_code, content, error_msg
--    from net._http_response order by created desc limit 20;
-- ============================================================================

-- ── Розширення ──────────────────────────────────────────────────────────────

-- Саме так його вмикає документація Supabase: схема pg_catalog, а доступ до
-- таблиць розкладу — власникові бази.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- pg_net у проєкті вже стоїть (у схемі extensions, функції — у схемі net);
-- рядок лише на випадок чистої бази.
create extension if not exists pg_net with schema extensions;

-- ── Таблиця ─────────────────────────────────────────────────────────────────

create table if not exists public.timer_pushes (
  -- Придумує клієнт: скасувати будильник треба вміти одразу, не чекаючи, поки
  -- база відповість на запис.
  id         uuid primary key,
  user_id    uuid not null default auth.uid()
               references public.profiles (id) on delete cascade,
  fire_at    timestamptz not null,
  title      text not null,
  body       text not null default '',
  -- Куди вести після натиску: сторінка готування цього рецепта.
  url        text,
  created_at timestamptz not null default now(),

  -- Рядки пише сам користувач, а сервер пересилає їх у пуш як є. Служба пуша
  -- приймає до 4 КБ, тож довжину обмежуємо тут, а не сподіваємось на клієнт.
  constraint timer_pushes_title_len check (char_length(title) between 1 and 120),
  constraint timer_pushes_body_len  check (char_length(body) <= 300),
  -- Лише шлях усередині застосунку: натиск на сповіщення не має вести деінде.
  constraint timer_pushes_url_local check (
    url is null or (url like '/%' and url not like '//%' and char_length(url) <= 300)
  )
);

-- Пристрій, на якому запустили таймер: адреса його пуш-підписки
-- (push_subscriptions.endpoint). Сервер дзвонить лише туди, а не на всі
-- пристрої акаунта — інакше «час вийшов» лунав би й на ноутбуці в іншій
-- кімнаті, а на спільному телефоні, чия підписка записана на іншу людину,
-- навпаки, не лунав би ніде, крім її пристроїв.
--
-- Окремим alter, а не в create table: перша версія цього файлу колонки не
-- мала, і повторний запуск на такій базі має її дописати. Без not null з тієї
-- ж причини — старі рядки (якщо були) її не мають; для нових адресу вимагає
-- запобіжник нижче, а маршрут рядок без адреси не надсилає нікому.
alter table public.timer_pushes
  add column if not exists endpoint text;

-- Єдиний запит, який тут має значення, — «що вже настало»; і робиться він
-- кожні пʼять секунд.
create index if not exists timer_pushes_fire_at_idx
  on public.timer_pushes (fire_at);

-- Для запобіжника нижче: скільки будильників у людини. І для застосунку,
-- що шукає свої «загублені» будильники цього пристрою.
create index if not exists timer_pushes_user_idx
  on public.timer_pushes (user_id);

/*
 * Запобіжник від зловживань.
 *
 * RLS каже лише «свої рядки», а не «скільки й на коли». Без меж один акаунт
 * міг би записати сто тисяч будильників на тиждень уперед по одному на пʼять
 * секунд — і база весь тиждень смикала б маршрут розсилки на кожному кроці
 * розкладу, а прибирання, що зносить лише прострочене, таких рядків не
 * торкнулось би ніколи.
 *
 * - fire_at не далі ніж за добу: найдовший таймер у рецепті — години, не дні.
 * - Не більше 20 будильників на людину. Таймер — по одному на крок, і
 *   рецептів може йти два-три разом; решта запасу — на кілька пристроїв і на
 *   скасування, що не дійшли.
 *   Рядок, який переписують (той самий id), не рахуємо: повторний запис
 *   будильника, коли дозвіл дали вже після старту, не має впиратись у межу.
 * - created_at ставить база: клієнтові в ньому вірити нема підстав.
 * - endpoint — підписка, яку база знає саме за цією людиною. Перевірка йде
 *   з правами того, хто пише, тож RLS таблиці підписок сам показує лише свої:
 *   чужу адресу чи вигадану вписати не вийде. Маршрут розсилки однаково
 *   шукає підписку за адресою І власником, тож це не єдиний захист, — зате
 *   застосунок дізнається про «пристрій не підписаний» одразу, відмовою на
 *   запис, а не мовчанням у мить, коли мав бути дзвінок.
 *
 * Лічильник захищено блокуванням на людину: інакше сотня паралельних вставок
 * порахувала б «ще 19» кожна й пройшла б усі разом.
 */
create or replace function public.timer_pushes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;

  if new.fire_at > now() + interval '1 day' then
    raise exception 'timer_pushes: будильник більш ніж на добу вперед'
      using errcode = 'check_violation';
  end if;

  if new.endpoint is null or not exists (
    select 1 from public.push_subscriptions
    where endpoint = new.endpoint and user_id = new.user_id
  ) then
    raise exception 'timer_pushes: цей пристрій не підписаний на сповіщення'
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('timer_pushes:' || new.user_id::text, 0));
  if (
    select count(*) from public.timer_pushes
    where user_id = new.user_id and id <> new.id
  ) >= 20 then
    raise exception 'timer_pushes: забагато будильників'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists timer_pushes_guard on public.timer_pushes;
create trigger timer_pushes_guard
  before insert or update on public.timer_pushes
  for each row execute function public.timer_pushes_guard();

alter table public.timer_pushes enable row level security;

drop policy if exists "timer push own select" on public.timer_pushes;
drop policy if exists "timer push own insert" on public.timer_pushes;
drop policy if exists "timer push own update" on public.timer_pushes;
drop policy if exists "timer push own delete" on public.timer_pushes;

-- Кожен бачить і чіпає лише свої будильники. Маршрут розсилки ходить службовим
-- ключем і RLS обходить. Select потрібен і клієнту: upsert без нього не
-- працює, а сторінка готування ним шукає свої загублені будильники (ті, про
-- які забув застосунок, вивантажений разом зі сховищем). У публікацію
-- realtime таблицю навмисно не додаємо — дивитись на
-- неї наживо нікому.
create policy "timer push own select" on public.timer_pushes
  for select using (auth.uid() = user_id);

create policy "timer push own insert" on public.timer_pushes
  for insert with check (auth.uid() = user_id);

create policy "timer push own update" on public.timer_pushes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "timer push own delete" on public.timer_pushes
  for delete using (auth.uid() = user_id);

-- ── Хто кличе маршрут ───────────────────────────────────────────────────────

/*
 * Кличе /api/push/timers, коли якийсь будильник настав.
 *
 * Сам нічого не надсилає і рядків не видаляє: забирає їх маршрут, атомарно,
 * щоб два виклики, що наклалися, не продзвонили двічі.
 *
 * Запас у 2 секунди — той самий, що TIMER_LEAD_MS у src/lib/timer-push.ts:
 * між «час настав» і дзвінком у кишені ще крок розкладу, виклик маршруту й
 * доставка.
 *
 * І межа в 10 хвилин — та сама, що TIMER_STALE_MS: такий будильник маршрут
 * однаково вже не надішле, тож і кликати його заради нього нема чого. Без
 * цієї умови зламана розсилка (немає секрету, маршрут відповідає 401)
 * смикалась би кожні пʼять секунд, аж поки рядок не прибере прибирання
 * нижче, — годину замість десяти хвилин.
 *
 * Обидва числа звіряє з кодом npm run check:push — міняти разом.
 *
 * security definer — щоб читати Vault; тому й відбираємо право виклику в усіх,
 * крім власника: інакше будь-хто міг би смикати розсилку через /rest/v1/rpc.
 */
create or replace function public.dispatch_timer_pushes()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  site   text;
  secret text;
begin
  if not exists (
    select 1 from public.timer_pushes
    where fire_at <= now() + interval '2 seconds'
      and fire_at >= now() - interval '10 minutes'
  ) then
    return;
  end if;

  select decrypted_secret into site
    from vault.decrypted_secrets where name = 'nyam_site_url' limit 1;
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'nyam_push_secret' limit 1;

  if coalesce(site, '') = '' or coalesce(secret, '') = '' then
    raise warning 'timer_pushes: немає секретів nyam_site_url / nyam_push_secret у Vault — див. supabase/timer-push.sql';
    return;
  end if;

  perform net.http_post(
    url := rtrim(site, '/') || '/api/push/timers',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    -- Холодний старт маршруту на Vercel буває кілька секунд; двох мало.
    timeout_milliseconds := 10000
  );
end;
$$;

revoke execute on function public.dispatch_timer_pushes() from public, anon, authenticated;

-- ── Розклад ─────────────────────────────────────────────────────────────────

-- Спершу знімаємо старі завдання з тими самими назвами: так повторний запуск
-- файлу оновлює розклад, а не падає й не плодить дублікати.
select cron.unschedule(jobid)
from cron.job
where jobname in ('nyam-timer-pushes', 'nyam-timer-pushes-cleanup', 'nyam-cron-history-cleanup');

select cron.schedule(
  'nyam-timer-pushes',
  '5 seconds',
  'select public.dispatch_timer_pushes()'
);

/*
 * Запобіжник: будильники, прострочені більш ніж на годину.
 *
 * Звичайно рядок живе до дзвінка або до скасування. Лишитись він може, коли
 * розсилка зламана (немає секрету, маршрут відповідає 401). Кликати маршрут
 * заради нього база перестає вже через 10 хвилин (див. dispatch_timer_pushes),
 * але рядок лежав би вічно — і рахувався б у межу «20 на людину». Година —
 * щоб устигнути помітити й розібратись, а не вічність. Менше за 10 хвилин
 * ставити не можна: прибирання зносило б те, що маршрут ще надіслав би
 * (перевіряє npm run check:push).
 */
select cron.schedule(
  'nyam-timer-pushes-cleanup',
  '*/10 * * * *',
  $$delete from public.timer_pushes where fire_at < now() - interval '1 hour'$$
);

/*
 * Історія запусків.
 *
 * pg_cron записує кожен запуск у cron.job_run_details і сам її не чистить.
 * Завдання раз на пʼять секунд — це 17 тисяч рядків на добу, які нікому не
 * потрібні: для розслідування досить останньої доби. Чистимо всю історію, а
 * не лише свою, — інших завдань у цій базі немає, а якщо зʼявляться, доба
 * історії й для них розумна межа.
 */
select cron.schedule(
  'nyam-cron-history-cleanup',
  '17 3 * * *',
  $$delete from cron.job_run_details where start_time < now() - interval '1 day'$$
);

notify pgrst, 'reload schema';
