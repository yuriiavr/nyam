-- ============================================================================
--  Ням — калорії рецепта рахує ШІ.
--
--  Виконувати в Supabase → SQL Editor після timer-push.sql: секрети у Vault ті
--  самі (nyam_site_url і nyam_push_secret), і pg_net із pg_cron уже стоять.
--  Скрипт ідемпотентний.
--
--  ДО деплою коду: застосунок читає ai_nutrition зі стрічки
--  (recipes_with_stats), і без колонки стрічка не завантажиться.
--
--  Як це працює. Щойно в рецепті змінились назва, опис, склад чи кроки, база
--  стирає старе число і сама кличе /api/recipe/nutrition — а той просить
--  Gemini порахувати страву й записує результат у ai_nutrition. Кличе саме
--  база, а не застосунок: на iPhone застосунок любить заснути одразу після
--  «Рецепт збережено», і тоді запит із телефона не пішов би ніколи. Поки числа
--  немає, застосунок показує оцінку за довідником продуктів, а щойно воно
--  зʼявиться — realtime принесе його сам.
--
--  Що не вдалось (Gemini перевантажений, маршрут ще не задеплоєно), раз на
--  годину добирає розклад nyam-recipe-nutrition. Перерахувати все наново
--  (скажімо, після зміни підказки): npm run nutrition:recompute -- --all
--
--  Чому не рахується — дивитись тут (відповідь маршруту: status і причина):
--
--    select created, status_code, content, error_msg
--    from net._http_response order by created desc limit 20;
-- ============================================================================

-- ── Колонки ─────────────────────────────────────────────────────────────────

-- КБЖВ усієї страви від ШІ: { kcal, protein, fat, carbs, note, items, model }.
-- null — ще не пораховано або склад щойно змінився.
alter table public.recipes
  add column if not exists ai_nutrition jsonb;

-- Номер версії складу: росте з кожною зміною назви, опису, складу чи кроків.
-- Сервер записує число лише в ту версію, яку бачила модель: інакше рахунок,
-- що летів, поки автор виправляв «200 г» на «20 г», ліг би поверх нового складу.
alter table public.recipes
  add column if not exists content_rev int not null default 0;

comment on column public.recipes.ai_nutrition is
  'КБЖВ усієї страви від ШІ (/api/recipe/nutrition). Пише лише сервер; зміна складу обнуляє.';
comment on column public.recipes.content_rev is
  'Версія складу для ai_nutrition. Веде тригер recipes_before_write.';

-- ── Сторож запису ───────────────────────────────────────────────────────────

/*
 * Замість простого recipes_touch, який лише ставив updated_at.
 *
 * 1. Змінились назва, опис, склад чи кроки — старе число вже неправда: стираємо
 *    його й піднімаємо версію. Порції, фото, теги на калорії страви не
 *    впливають (рахуємо всю страву, не порцію), тож число лишається.
 * 2. Клієнт (ролі anon і authenticated) ai_nutrition і content_rev не пише:
 *    інакше автор міг би вписати своїй страві будь-які калорії. Пише сервер —
 *    службовим ключем (роль service_role) — або SQL Editor.
 * 3. updated_at не рухаємо, коли змінилось лише число від ШІ. За цим часом
 *    застосунок звіряє свої недоставлені правки з базою (mergeRecipes у
 *    src/lib/sync.ts): запис ШІ, що прийшов на секунду пізніше за правку, яка
 *    так і не долетіла, «переміг» би її — і правка зникла б.
 */
create or replace function public.recipes_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  from_client constant boolean := current_user in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    if from_client then
      new.ai_nutrition := null;
      new.content_rev := 0;
    end if;
    return new;
  end if;

  if new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.ingredients is distinct from old.ingredients
     or new.steps is distinct from old.steps then
    new.content_rev := old.content_rev + 1;
    new.ai_nutrition := null;
  elsif from_client then
    new.content_rev := old.content_rev;
    new.ai_nutrition := old.ai_nutrition;
  end if;

  if new.ai_nutrition is distinct from old.ai_nutrition
     and to_jsonb(new) - 'ai_nutrition' - 'updated_at' = to_jsonb(old) - 'ai_nutrition' - 'updated_at' then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists recipes_touch on public.recipes;
drop trigger if exists recipes_before_write on public.recipes;
create trigger recipes_before_write
  before insert or update on public.recipes
  for each row execute function public.recipes_before_write();

-- ── Хто кличе ШІ ────────────────────────────────────────────────────────────

/*
 * Після запису: новий рецепт або нова версія складу — просимо порахувати.
 *
 * pg_net шле запит уже після коміту, тож маршрут бачить рядок, а відкочена
 * транзакція не коштує нам виклику моделі. Тіло — лише id: маршрут перечитує
 * рецепт сам, службовим ключем, і не вірить тому, що прийшло ззовні.
 *
 * Хвилина очікування: маршрут живе до 60 секунд, а модель із повтором на
 * «перевантажена» інколи бере пів хвилини.
 *
 * security definer — щоб читати Vault. Викликати напряму її не можна: функцію,
 * що повертає trigger, Postgres запускає лише як тригер.
 */
create or replace function public.recipes_request_nutrition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  site   text;
  secret text;
begin
  if new.ai_nutrition is not null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.content_rev = old.content_rev then
    return null;
  end if;

  select decrypted_secret into site
    from vault.decrypted_secrets where name = 'nyam_site_url' limit 1;
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'nyam_push_secret' limit 1;

  if coalesce(site, '') = '' or coalesce(secret, '') = '' then
    raise warning 'recipe nutrition: немає секретів nyam_site_url / nyam_push_secret у Vault — див. supabase/timer-push.sql';
    return null;
  end if;

  perform net.http_post(
    url := rtrim(site, '/') || '/api/recipe/nutrition',
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    timeout_milliseconds := 60000
  );
  return null;
end;
$$;

drop trigger if exists recipes_request_nutrition on public.recipes;
create trigger recipes_request_nutrition
  after insert or update of title, description, ingredients, steps on public.recipes
  for each row execute function public.recipes_request_nutrition();

-- ── Добір того, що не вдалось ───────────────────────────────────────────────

/*
 * Раз на годину: якщо є рецепти без числа, старші за дві хвилини (молодші ще
 * рахуються своїм запитом), — просимо маршрут добрати їх. Сам маршрут бере
 * скільки встигне за хвилину, у випадковому порядку: рецепт, який не
 * рахується ніколи, не загородить черги іншим.
 *
 * Добір не коштує нічого, коли все пораховано: запит назовні йде лише тоді,
 * коли є що добирати.
 */
create or replace function public.sweep_recipe_nutrition()
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
    select 1 from public.recipes
    where ai_nutrition is null and updated_at < now() - interval '2 minutes'
  ) then
    return;
  end if;

  select decrypted_secret into site
    from vault.decrypted_secrets where name = 'nyam_site_url' limit 1;
  select decrypted_secret into secret
    from vault.decrypted_secrets where name = 'nyam_push_secret' limit 1;

  if coalesce(site, '') = '' or coalesce(secret, '') = '' then
    raise warning 'recipe nutrition: немає секретів nyam_site_url / nyam_push_secret у Vault — див. supabase/timer-push.sql';
    return;
  end if;

  perform net.http_post(
    url := rtrim(site, '/') || '/api/recipe/nutrition',
    body := '{"sweep": true}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    timeout_milliseconds := 60000
  );
end;
$$;

-- Ця вже звичайна функція, тож /rest/v1/rpc показав би її кожному.
revoke execute on function public.sweep_recipe_nutrition() from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'nyam-recipe-nutrition';

select cron.schedule(
  'nyam-recipe-nutrition',
  '41 * * * *',
  'select public.sweep_recipe_nutrition()'
);

-- ── Стрічка ─────────────────────────────────────────────────────────────────

-- Вʼюху саме ПЕРЕСТВОРЮЄМО: Postgres розгортає `r.*` у перелік колонок під
-- час створення, і нових колонок вона сама не побачить (див. recipe-course.sql).
drop view if exists public.recipes_with_stats;

create view public.recipes_with_stats
with (security_invoker = on) as
select
  r.*,
  st.likes,
  st.saves,
  st.cooks,
  st.rating_sum,
  st.rating_count
from public.recipes r
join public.recipe_stats st on st.recipe_id = r.id;

notify pgrst, 'reload schema';
