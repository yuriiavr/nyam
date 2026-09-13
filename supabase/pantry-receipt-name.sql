-- ============================================================================
--  Ням — касова назва окремо від назви, яку бачить людина.
--
--  Виконувати в Supabase → SQL Editor після schema.sql і family.sql, ДО деплою
--  коду, що читає receipt_name і updated_at (інакше читання комори впаде).
--  Від products.sql не залежить (на живій базі — після нього, див. README).
--  Скрипт ідемпотентний: його безпечно запускати повторно. Цілим файлом —
--  так він іде однією транзакцією.
--
--  Після контрактного кроку (pantry-products-contract.sql) і на свіжій базі з
--  schema.sql тимчасового перенесення касового тексту вже немає — і повторний
--  запуск цього файлу його не повертає (див. «контракт» нижче).
--
--  Навіщо. Імпорт чека клав у label касовий текст — «Мол950УлГаличБЛак2.5», і
--  людина бачила його замість «Молоко безлактозне». Тепер сирий текст живе в
--  receipt_name (походження, для навчання й підказок), а label — лише назва,
--  яку хтось обрав свідомо (OFF, список покупок, ручна).
--
--  Старий застосунок (закешований PWA) про receipt_name не знає: пише касовий
--  текст у label, як і раніше, і пересилає його з кожною правкою. Тригер нижче
--  переносить такий текст на льоту — до контрактного кроку I6.
-- ============================================================================

-- Прапорець «колонку receipt_name додає саме цей запуск» — для разового
-- перенесення наявних касових label нижче. Повторний запуск його не робить:
-- до того часу касовий текст старих клієнтів переносить тригер, а label, що
-- лишились, — свідомі назви нового застосунку («Сир5%» зі списку покупок).
-- Локальний для транзакції файлу.
select set_config('nyam.pantry_receipt_name_fresh',
  case when exists (select 1 from pg_attribute
                     where attrelid = 'public.pantry_items'::regclass
                       and attname = 'receipt_name' and not attisdropped)
       then '' else 'on' end, true);

-- «Контракт уже стоїть»: у pantry_items.id є default. Його ставить лише
-- контрактний крок або schema.sql свіжої бази — тобто старих клієнтів, для
-- яких існує перенесення касового label, уже немає. Тоді тригер і функції
-- нижче наприкінці прибираються знову, а дані не чіпаються.
select set_config('nyam.pantry_contract',
  case when exists (select 1 from pg_attrdef d
                      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                     where d.adrelid = 'public.pantry_items'::regclass and a.attname = 'id')
       then 'on' else '' end, true);

alter table public.pantry_items add column if not exists receipt_name text;
-- Коли рядок востаннє писали. Потрібно I4 (pantry-products.sql), щоб із копій
-- одного продукту в сімʼї лишити найсвіжішу. Наявні рядки отримають час запуску.
alter table public.pantry_items add column if not exists updated_at timestamptz not null default now();
alter table public.pantry_items drop constraint if exists pantry_items_receipt_name_len;
alter table public.pantry_items add constraint pantry_items_receipt_name_len
  check (receipt_name is null or char_length(receipt_name) <= 200);

comment on column public.pantry_items.receipt_name is
  'Сирий текст рядка з чека (походження); показується лише як запасна назва.';

-- updated_at веде база, а не клієнт: клієнт його не шле й не знає.
create or replace function public.pantry_items_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists pantry_items_touch on public.pantry_items;
create trigger pantry_items_touch before update on public.pantry_items
  for each row execute function public.pantry_items_touch();

-- Касовий текст: одне «слово» з кирилицею, 5+ символів, із цифрою або
-- «малаВелика» всередині. Кирилиця обовʼязкова — латинські назви з OFF на
-- кшталт «McCain» чи «7Days» не чіпаємо. Звірено з живими рядками: рівно
-- «ІмбирКг», «Масл180МолСолод73», «Мол950УлГаличБЛак2.5»; «Вершки» й
-- «Teriyaki Sauce» — ні.
create or replace function public.looks_like_till_text(t text)
returns boolean language sql immutable parallel safe set search_path = pg_catalog as $$
  select t is not null and t !~ '\s' and char_length(t) >= 5
     and t ~ '[А-Яа-яІіЇїЄєҐґ]'
     and (t ~ '[0-9]' or t ~ '[а-яіїєґ][А-ЯІЇЄҐ]')
$$;

-- Переносимо касовий текст зі старих клієнтів у receipt_name.
--
-- Тонкість upsert-а старого клієнта: PostgREST будує
-- `insert … on conflict do update set label = excluded.label, …` — лише з
-- колонками, які клієнт прислав, тобто БЕЗ receipt_name. excluded несе зміни
-- BEFORE INSERT-тригерів, тож якби insert розщепив label сам, у наявний рядок
-- пішов би label = null, а receipt_name лишився б старим — касовий текст
-- загубився б. Тому, коли рядок із тим самим ключем уже є, insert label не
-- чіпає: розщепить гілка UPDATE, де видно й старе значення. Звичайний insert
-- на наявний ключ однаково впаде з 23505, а on conflict do nothing нічого не
-- запише — в обох випадках нічого не губиться.
--
-- Invoker: перевірка «ключ уже є» йде від імені того, хто пише, під RLS.
-- Чужий невидимий рядок = «немає» → розщеплюємо одразу, а сам запис однаково
-- відсіче політика.
--
-- Лише записи СТАРОГО клієнта. Після pantry-products.sql у рядку є колонка id,
-- і тоді label пише й новий застосунок — свідомо: назва зі списку покупок
-- («Сир5%», «Молоко2.5%»), з OFF, набрана руками. Касовий текст новий код кладе
-- в receipt_name сам, тож його label переносити не можна: «Сир5%» став би
-- «доказом з каси», а на рядку, що вже має справжній receipt_name, затер би
-- його. Відрізнити записи можна лише за id: старий клієнт його не знає, і
-- тимчасовий pantry_items_before_insert (іде раніше за абеткою) ставить
-- nyam.legacy_pantry_write = мітка цього оператора. Гілка UPDATE upsert-а
-- старого клієнта — той самий оператор, тож прапорець бачить і вона. Мітка, а
-- не «on»: прапорець живе до кінця транзакції, і наступний оператор тієї самої
-- транзакції (SQL Editor, definer-оновлення) за старий запис не зійде.
-- Старий клієнт пише комору лише POST-upsert-ом (без PATCH), тож інших його
-- записів тут немає. До I4 колонки id немає — там пише лише старий клієнт.
create or replace function public.pantry_items_split_receipt_label()
returns trigger language plpgsql set search_path = public as $$
declare
  j jsonb;
  pending boolean := false;
begin
  if not public.looks_like_till_text(new.label) then return new; end if;
  j := to_jsonb(new);
  if j ? 'id' and current_setting('nyam.legacy_pantry_write', true)
                  is distinct from statement_timestamp()::text then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if j ? 'id' then
      -- Після pantry-products.sql ключ — id, і BEFORE INSERT-тригер
      -- pantry_items_before_insert (іде раніше за абеткою) вже його поставив.
      -- Динамічно: до I4 колонки id немає, і статичний запит не спланувався б.
      if j ->> 'id' is not null then
        execute 'select exists (select 1 from public.pantry_items where id = $1)'
          into pending using (j ->> 'id')::uuid;
      end if;
    else
      pending := exists (select 1 from public.pantry_items p
                          where p.user_id = new.user_id and p.ingredient_key = new.ingredient_key);
    end if;
    if pending then return new; end if;
    new.receipt_name := coalesce(new.receipt_name, left(new.label, 200));
  elsif new.receipt_name is not distinct from old.receipt_name then
    -- receipt_name цей запит не міняв (старий клієнт його не знає) — свіжий
    -- касовий текст із label і є походженням останньої покупки.
    new.receipt_name := left(new.label, 200);
  else
    new.receipt_name := coalesce(new.receipt_name, left(new.label, 200));
  end if;
  new.label := null;
  return new;
end $$;
drop trigger if exists pantry_items_split_receipt_label on public.pantry_items;
create trigger pantry_items_split_receipt_label before insert or update on public.pantry_items
  for each row execute function public.pantry_items_split_receipt_label();

-- Наявні касові label — лише в першому запуску (див. прапорець угорі): тоді
-- всі вони від старого застосунку. Пізніше label із «цифрою в слові» пише й
-- новий код свідомо, і повторний запуск не має його переносити.
update public.pantry_items
   set receipt_name = coalesce(receipt_name, left(label, 200)), label = null
 where nullif(current_setting('nyam.pantry_receipt_name_fresh', true), '') = 'on'
   and nullif(current_setting('nyam.pantry_contract', true), '') is distinct from 'on'
   and public.looks_like_till_text(label);
select set_config('nyam.pantry_receipt_name_fresh', '', true);

-- Безлактозне молоко з чека тут свідомо НЕ стає типом moloko_bezlaktozne.
-- Старий застосунок (469a0f4) такого ключа не знає: показав би сирий
-- «moloko_bezlaktozne» з 🍽️, рецепти з молоком вважали б його відсутнім, а
-- вкладка, що ще тримає рядок «moloko», наступною правкою записала б друге
-- молоко. Новий код і так показує рядок назвою з каси («Молоко безлактозне
-- Галичина 2,5%») і рахує його молоком; тип уточнює перша ж картка товару, а
-- решту — контрактний крок, коли старих застосунків уже немає.

-- ── Права на функції ───────────────────────────────────────────────────────
-- Права за замовчуванням Supabase дають EXECUTE кожній новій функції напряму
-- anon і authenticated, тож revoke називає всі три ролі. Тригерні функції
-- як RPC не викликати, але закриваємо однаково — щоб їх не було в /rpc.
--
-- looks_like_till_text лишається виконуваною для authenticated: її викликає
-- тригер pantry_items_split_receipt_label, а EXECUTE вкладеної функції
-- Postgres перевіряє від того, хто пише рядок (старий клієнт — authenticated).
-- Закрити її — і кожен запис у комору впаде з 42501. Функція чиста й нічого
-- не читає; anon у комору не пише взагалі.
revoke all on function public.pantry_items_touch()               from public, anon, authenticated;
revoke all on function public.pantry_items_split_receipt_label() from public, anon, authenticated;
revoke all on function public.looks_like_till_text(text)         from public, anon;
grant execute on function public.looks_like_till_text(text)      to authenticated;

-- Контракт уже стоїть (див. угорі) — тимчасове для старих клієнтів знову
-- прибираємо, рівно як pantry-products-contract.sql. Інакше повторний запуск
-- цього файлу через місяць почав би переносити назви, які людина набрала
-- сама («Сир5%»), і відкотив би контрактний крок.
do $$
begin
  if nullif(current_setting('nyam.pantry_contract', true), '') = 'on' then
    drop trigger if exists pantry_items_split_receipt_label on public.pantry_items;
    drop function if exists public.pantry_items_split_receipt_label();
    drop function if exists public.looks_like_till_text(text);
  end if;
end $$;
select set_config('nyam.pantry_contract', '', true);

notify pgrst, 'reload schema';
