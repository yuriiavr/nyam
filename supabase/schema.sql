-- ============================================================================
--  Ням — схема бази для Supabase (Postgres)
--
--  Виконувати в Supabase → SQL Editor → New query → Run.
--  Скрипт ідемпотентний: його безпечно запускати повторно.
--
--  Після нього виконай supabase/seed.sql, щоб залити демо-спільноту
--  (6 кухарів і 23 рецепти) — інакше стрічка буде порожньою.
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists pg_trgm;

-- ── Профілі ────────────────────────────────────────────────────────────────
-- Свідомо БЕЗ зовнішнього ключа на auth.users: так у базі можуть жити
-- демо-кухарі, у яких немає акаунта. Для справжніх користувачів id завжди
-- дорівнює auth.uid() — це гарантують RLS-політики нижче.
create table if not exists public.profiles (
  id          uuid primary key default uuid_generate_v4(),
  handle      text unique not null,
  name        text not null default 'Кухар',
  emoji       text not null default '🧑‍🍳',
  gradient    text[] not null default array['#ff6b35', '#ffb020'],
  bio         text not null default '',
  city        text,
  avatar_url  text,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── Рецепти ────────────────────────────────────────────────────────────────
create table if not exists public.recipes (
  id           uuid primary key default uuid_generate_v4(),
  author_id    uuid not null references public.profiles (id) on delete cascade,
  title        text not null check (char_length(title) between 2 and 120),
  description  text not null default '',
  emoji        text not null default '🍽️',
  gradient     text[] not null default array['#ff6b35', '#ffb020'],
  image_url    text,
  cuisine      text not null default 'Домашня',
  meal_types   text[] not null default '{}',
  moods        text[] not null default '{}',
  tags         text[] not null default '{}',
  time_min     int  not null default 30 check (time_min between 1 and 1440),
  difficulty   int  not null default 1 check (difficulty between 1 and 3),
  servings     int  not null default 2 check (servings between 1 and 50),
  kcal         int,
  cost_level   int  not null default 1 check (cost_level between 1 and 3),
  -- [{ "key": "kartoplya", "qty": "4 шт", "optional": false }]
  ingredients  jsonb not null default '[]'::jsonb,
  -- [{ "text": "...", "timerSec": 600, "tip": "..." }]
  steps        jsonb not null default '[]'::jsonb,
  source_id    uuid references public.recipes (id) on delete set null,
  is_public    boolean not null default true,
  -- Чим страва є на столі: гарнір, основна, суп… Порожньо — рецепт створено
  -- до появи поля, і частину виводить сам застосунок.
  course       text,
  -- Базова популярність демо-рецептів, щоб стрічка не була порожньою.
  seed_likes   int not null default 0,
  seed_saves   int not null default 0,
  seed_cooks   int not null default 0,
  seed_rating_sum   int not null default 0,
  seed_rating_count int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists recipes_author_idx      on public.recipes (author_id);
create index if not exists recipes_created_idx     on public.recipes (created_at desc);
create index if not exists recipes_title_trgm      on public.recipes using gin (title gin_trgm_ops);
create index if not exists recipes_ingredients_idx on public.recipes using gin (ingredients);
create index if not exists recipes_tags_idx        on public.recipes using gin (tags);

-- ── Соціальні взаємодії ────────────────────────────────────────────────────
create table if not exists public.likes (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  recipe_id  uuid not null references public.recipes  (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table if not exists public.saves (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  recipe_id  uuid not null references public.recipes  (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table if not exists public.wishlist (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  recipe_id  uuid not null references public.recipes  (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table if not exists public.ratings (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  recipe_id  uuid not null references public.recipes  (id) on delete cascade,
  stars      int  not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

create table if not exists public.cooks (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  recipe_id  uuid not null references public.recipes  (id) on delete cascade,
  cooked_at  timestamptz not null default now()
);
create index if not exists cooks_user_idx on public.cooks (user_id, cooked_at desc);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- ── Особисті дані ──────────────────────────────────────────────────────────
create table if not exists public.pantry_items (
  -- Рядок = одна покупка (пачка), а не «людина + тип»: два різні молока —
  -- два рядки. Бази, створені раніше, приходять сюди через
  -- pantry-receipt-name.sql → pantry-products.sql → pantry-products-contract.sql.
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  -- Тип рядка: за ним рецепти шукають «що є». Коли є товар — дорівнює його типу
  -- (тригери нижче), клієнт його не перебʼє.
  ingredient_key text not null,
  -- Товар (products.id). Без FK навмисно, як shopping_items.recipe_id: картки
  -- створюються лише онлайн, а рядок комори живе й офлайн.
  product_id     uuid,
  label          text,
  -- Сирий текст рядка з чека (походження); показується лише як запасна назва.
  receipt_name   text,
  -- Скільки продукту вдома: число окремо від одиниці, як і в рецептах.
  -- Так «200 г» можна порівняти з потребою рецепта, а не лише показати.
  amount         numeric(10, 2),
  unit           text,
  -- Старий вільний текст кількості; лишається заради записів до появи одиниць.
  qty            text,
  barcode        text,
  -- Скільки коштував грам продукту в останній покупці: з чека відома і сума,
  -- і кількість, а через грам ціна зводиться з кількостями рецептів.
  price_per_gram numeric(10, 6),
  added_at       timestamptz not null default now(),
  -- Строк придатності. Дата, а не мітка часу: година тут нічого не означає.
  expires_at     date,
  -- Коли рядок востаннє писали; веде база (pantry_items_touch), клієнт не шле.
  updated_at     timestamptz not null default now(),
  constraint pantry_items_receipt_name_len check (receipt_name is null or char_length(receipt_name) <= 200)
);

create index if not exists pantry_items_expires_idx
  on public.pantry_items (user_id, expires_at)
  where expires_at is not null;

-- ── Список покупок ─────────────────────────────────────────────────────────
-- Окрема таблиця, а не похідна від плану: у список дописують батарейки й
-- «щось до чаю» — те, до чого застосунку діла немає, але без чого список
-- у магазині неправдивий. Похідну не відредагуєш: вона рахується наново.
create table if not exists public.shopping_items (
  -- Ідентифікатор свій, а не пара «користувач + продукт»: у списку буває
  -- два однакові рядки з різних причин, а довільний запис ключа не має.
  id             uuid primary key,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  ingredient_key text,
  text           text,
  amount         numeric(10, 2),
  unit           text,
  done           boolean not null default false,
  added_at       timestamptz not null default now(),
  source         text,
  -- Без зовнішнього ключа навмисно: рецепт, який щойно створили, потрапляє в
  -- базу на секунду пізніше за покупки з нього, і ключ рубав би всю пачку.
  recipe_id      uuid,
  constraint shopping_items_named check (ingredient_key is not null or text is not null)
);

create index if not exists shopping_items_user_idx
  on public.shopping_items (user_id, added_at desc);

-- Власник рядка не змінюється ніколи.
--
-- Ключ таблиці — сам рядок, а не пара «людина + продукт», як у коморі. Тому
-- upsert від іншого учасника сімʼї переписав би user_id на себе: досить
-- поставити галочку на чужому хлібі. Далі це тихо коштувало б даних — при
-- виході з сімʼї покупки пішли б за тим, хто останній їх торкався, а не за
-- тим, хто їх додав.
create or replace function public.keep_shopping_owner()
returns trigger language plpgsql as $$
begin
  new.user_id := old.user_id;
  return new;
end;
$$;

drop trigger if exists shopping_items_keep_owner on public.shopping_items;
create trigger shopping_items_keep_owner
  before update on public.shopping_items
  for each row execute function public.keep_shopping_owner();


create table if not exists public.plan_slots (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  day        date not null,
  slot       text not null check (slot in ('breakfast', 'lunch', 'dinner')),
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  primary key (user_id, day, slot)
);

create table if not exists public.dismissed (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  recipe_id  uuid not null references public.recipes  (id) on delete cascade,
  primary key (user_id, recipe_id)
);

-- Кеш товарів зі сканера штрихкодів (щоб не смикати Open Food Facts щоразу)
create table if not exists public.barcode_cache (
  barcode        text primary key,
  name           text not null,
  brand          text,
  image_url      text,
  ingredient_key text,
  -- Те, що знає етикетка: вага пачки та харчова цінність на 100 г. З ними
  -- знайомий товар додається в комору одним дотиком, з вагою й калоріями.
  amount         numeric(10, 2),
  unit           text,
  kcal           numeric(10, 2),
  protein        numeric(10, 2),
  fat            numeric(10, 2),
  carbs          numeric(10, 2),
  -- Хто заповнив картку: довідник кодів спільний, і виправляти запис має
  -- право той, хто його зробив, а не будь-хто.
  taught_by      uuid references public.profiles (id) on delete set null,
  updated_at     timestamptz not null default now()
);

-- ── Продукти, дописані людьми ──────────────────────────────────────────────
-- Вбудований каталог покриває звичайну кухню, але не кожну. Дописане живе
-- тут: ключ із префіксом own_, щоб ніколи не збігтися з вбудованим.
create table if not exists public.custom_ingredients (
  key             text primary key check (key ~ '^own_[a-z0-9_]+$'),
  label           text not null check (length(btrim(label)) > 0),
  emoji           text not null default '🍽️',
  cat             text not null default 'other',
  aliases         text[] not null default '{}',
  staple          boolean not null default false,
  grams_per_piece numeric(10, 2),
  grams_per_cup   numeric(10, 2),
  default_unit    text not null default 'g',
  kcal            numeric(10, 2),
  protein         numeric(10, 2),
  fat             numeric(10, 2),
  carbs           numeric(10, 2),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  -- Загальніший тип: «Кефір безлактозний» → «kefir». Див. запобіжник нижче.
  parent_key      text,
  -- Номер правки й хто правив востаннє — веде запобіжник, а не клієнт.
  version         integer not null default 1,
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now(),
  -- Цей тип — псевдонім іншого (merge_custom_ingredients). Міняють лише функції обʼєднання.
  merged_into     text
);

-- Ті самі колонки для бази, створеної раніше: create table if not exists
-- наявної таблиці не чіпає, а запобіжник нижче без них ламав би кожен insert.
-- Дослівно як у supabase/ingredient-parents.sql.
alter table public.custom_ingredients
  add column if not exists parent_key text,
  add column if not exists version    integer not null default 1,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.custom_ingredients drop constraint if exists custom_ingredients_parent_fmt;
alter table public.custom_ingredients add constraint custom_ingredients_parent_fmt
  check (parent_key is null or (parent_key ~ '^[a-z][a-z0-9_]*$' and parent_key <> key));

-- ── Вбудовані типи ─────────────────────────────────────────────────────────
-- Дзеркало каталогу з коду: проти нього база перевіряє батьків дописаних
-- типів. Рядки заливає supabase/builtin-ingredients.sql (у setup.sql — одразу
-- після схеми); визначення тут дослівно те саме, що там.
create table if not exists public.builtin_ingredients (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]*$' and key !~ '^own_'),
  parent_key text references public.builtin_ingredients (key)
);

alter table public.builtin_ingredients enable row level security;
revoke all on public.builtin_ingredients from anon, authenticated;
grant select on public.builtin_ingredients to anon, authenticated;
drop policy if exists "builtin ingredients readable" on public.builtin_ingredients;
create policy "builtin ingredients readable" on public.builtin_ingredients
  for select using (true);

-- ── Агрегована статистика ──────────────────────────────────────────────────
-- Реальні дії користувачів + базові показники демо-рецептів.
create or replace view public.recipe_stats as
select
  r.id                                                     as recipe_id,
  r.seed_likes        + count(distinct l.user_id)          as likes,
  r.seed_saves        + count(distinct s.user_id)          as saves,
  r.seed_cooks        + count(distinct c.id)               as cooks,
  r.seed_rating_sum   + coalesce(sum(rt.stars), 0)         as rating_sum,
  r.seed_rating_count + count(distinct rt.user_id)         as rating_count
from public.recipes r
left join public.likes   l  on l.recipe_id  = r.id
left join public.saves   s  on s.recipe_id  = r.id
left join public.cooks   c  on c.recipe_id  = r.id
left join public.ratings rt on rt.recipe_id = r.id
group by r.id, r.seed_likes, r.seed_saves, r.seed_cooks,
         r.seed_rating_sum, r.seed_rating_count;

-- ── Тригери ────────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists recipes_touch on public.recipes;
create trigger recipes_touch
  before update on public.recipes
  for each row execute function public.touch_updated_at();

-- Запобіжник дерева типів. Invoker, а не definer: читає лише те, що й так
-- видно кожному (обидва каталоги відкриті на читання).
create or replace function public.custom_ingredients_guard()
returns trigger language plpgsql set search_path = public as $$
declare cur text; nxt text; depth int := 0; height int;
begin
  if tg_op = 'UPDATE' then
    -- Видалення профілю (акаунта) обнуляє created_by/updated_by окремим UPDATE
    -- від «on delete set null». Це не правка типу: ні номера правки, ні автора
    -- назад — інакше рядок посилався б на профіль, якого вже немає (ключ, що
    -- «не змінився», Postgres не перевіряє), або видалення акаунта падало б.
    -- Лише вкладений виклик (дія ключа — тригер на profiles) і лише обнулення:
    -- клієнт так не сховає ні автора, ні правку.
    if pg_trigger_depth() > 1
       and to_jsonb(new) - 'created_by' - 'updated_by' = to_jsonb(old) - 'created_by' - 'updated_by'
       and (new.created_by is null or new.created_by = old.created_by)
       and (new.updated_by is null or new.updated_by is not distinct from old.updated_by) then
      return new;
    end if;
    -- Ключ, автор і час створення не міняються; номер правки веде база, а не клієнт.
    new.key := old.key; new.created_by := old.created_by; new.created_at := old.created_at;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();

  if new.parent_key is not null
     and (tg_op = 'INSERT' or new.parent_key is distinct from old.parent_key) then
    -- Дві одночасні правки дерева не мають скласти цикл між собою.
    perform pg_advisory_xact_lock(hashtext('nyam:ingredient-tree'));
    cur := new.parent_key;
    -- Глибину рахуємо по всьому ланцюжку — і власних, і вбудованих типів.
    while cur is not null loop
      if cur = new.key then
        raise exception 'Тип не може бути різновидом самого себе' using errcode = '23514';
      end if;
      depth := depth + 1;
      if depth > 6 then raise exception 'Задовгий ланцюжок різновидів' using errcode = '23514'; end if;
      if cur like 'own\_%' then
        select c.parent_key into nxt from public.custom_ingredients c where c.key = cur;
      else
        select b.parent_key into nxt from public.builtin_ingredients b where b.key = cur;
      end if;
      if not found then raise exception 'Немає типу %', cur using errcode = '23503'; end if;
      cur := nxt;
    end loop;
    -- Переносять і гілку під цим типом: найглибший нащадок теж не глибший за
    -- шість рівнів, інакше клієнт (MAX_TYPE_DEPTH) обрізав би його родовід.
    with recursive below (key, h) as (
      select c.key, 1 from public.custom_ingredients c where c.parent_key = new.key
      union all
      select c.key, b.h + 1 from public.custom_ingredients c join below b on c.parent_key = b.key
       where b.h < 7
    )
    select coalesce(max(h), 0) into height from below;
    if depth + height > 6 then
      raise exception 'Задовгий ланцюжок різновидів' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists custom_ingredients_guard on public.custom_ingredients;
create trigger custom_ingredients_guard before insert or update on public.custom_ingredients
  for each row execute function public.custom_ingredients_guard();

-- Тригерна функція як RPC не викликається (Postgres відмовить сам), але права
-- за замовчуванням Supabase відкривають її клієнтам — закриваємо для порядку.
revoke all on function public.custom_ingredients_guard() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  Спільний каталог товарів (дослівно як supabase/products.sql,
--  receipt-learning.sql і community-merge.sql — без перенесення barcode_cache,
--  якого на свіжій базі немає). Правиш тут — правиш і там, і навпаки:
--  повторний запуск будь-якого з них на цій базі не має нічого змінювати.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Нормалізація: одна правда на всіх клієнтів ─────────────────────────────
-- Чисті функції, anon і authenticated можуть їх викликати навмисно: так
-- npm run db:check перевіряє, що база рахує ключі так само, як у тестах.

-- EAN-8 / EAN-13 (UPC-A доповнюється нулем) — або null, якщо код не товарний.
create or replace function public.normalize_ean(raw text)
returns text language plpgsql immutable parallel safe set search_path = pg_catalog as $$
declare d text := regexp_replace(coalesce(raw, ''), '\D', '', 'g'); n int; s int := 0; i int;
begin
  if length(d) = 12 then d := '0' || d; end if;                 -- UPC-A → EAN-13
  n := length(d);
  if n not in (8, 13) then return null; end if;
  -- Внутрішні коди магазину (вагові, цінники): EAN-13 з 2…, 02…, 04…; EAN-8 з 2….
  -- Той самий код у двох магазинах — різні товари, вчити за ним не можна.
  if (n = 13 and (d like '2%' or d like '02%' or d like '04%')) or (n = 8 and d like '2%') then return null; end if;
  -- Заглушки кас: «4820000000000» — після префікса самі нулі; або одна цифра
  -- всюди. Справжні коди можуть мати нулі посередині, тож лише «весь хвіст».
  if substr(d, 4, n - 4) ~ '^0+$' or d ~ '^(\d)\1+$' then return null; end if;
  for i in 1 .. n - 1 loop
    s := s + substr(d, n - i, 1)::int * case when i % 2 = 1 then 3 else 1 end;
  end loop;
  if (10 - s % 10) % 10 <> substr(d, n, 1)::int then return null; end if;
  return d;
end $$;

-- Ключ назви з чека. RECEIPT_KEY_VERSION = 1: змінити функцію — означає
-- перерахувати value з raw одним update (тригер нижче рахує value з raw).
-- Лишає цифри, десяткову крапку й %: «Молоко 1,5%» і «Молоко 15%», 900 г і
-- 950 г — різні товари. Пробіли, розділові знаки, регістр і латинські
-- двійники кирилиці в змішаному слові («МОЛOКО» з латинською O) — зникають.
create or replace function public.receipt_name_key(raw text)
returns text language plpgsql immutable parallel safe set search_path = pg_catalog as $$
declare tok text; k text := '';
begin
  if raw is null then return null; end if;
  foreach tok in array regexp_split_to_array(
      regexp_replace(raw, '(\d)\s*[.,]\s*(\d)', '\1.\2', 'g'),      -- «2,5» і «2 . 5» → «2.5»
      '[^0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґ.%]+') loop
    -- Лише мішанина алфавітів: «McCain» лишається латиницею, «МОЛOКО» стає кирилицею.
    if tok ~ '[A-Za-z]' and tok ~ '[А-Яа-яЁёІіЇїЄєҐґ]' then
      tok := translate(tok, 'AaBCcEeHIiKkMOoPpTXxYy', 'АаВСсЕеНІіКкМОоРрТХхУу');
    end if;
    k := k || regexp_replace(lower(tok), '(?<!\d)\.|\.(?!\d)', '', 'g');  -- крапка лишається лише між цифрами
  end loop;
  k := left(k, 160);
  return case when char_length(k) >= 3 then k end;
end $$;

-- Область назви з чека. Власні марки мереж звуться однаково, а означають
-- різне, тож назва з АТБ спершу вчиться для АТБ. Рахується ЛИШЕ всередині RPC
-- із сирих p_seller (продавець із чека) і p_chain (slug із chainOf).
create or replace function public.receipt_scope(p_seller text, p_chain text)
returns text language sql immutable parallel safe set search_path = public as $$
  select case
    when p_chain ~ '^[a-z0-9_]{2,24}$' then 'm:' || p_chain
    when public.receipt_name_key(p_seller) is not null then 's:' || left(public.receipt_name_key(p_seller), 60)
    else '' end
$$;

-- «Та сама назва + той самий бренд + та сама упаковка» — той самий товар.
-- Окремою функцією, бо нею ж save_product шукає, з ким саме збіглась картка.
-- 0,9 л і 900 мл — одна упаковка.
create or replace function public.product_identity_key(p_name text, p_brand text, p_pack_amount numeric, p_pack_unit text)
returns text language sql immutable parallel safe set search_path = pg_catalog as $$
  select lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g')) || '|' ||
         lower(regexp_replace(btrim(coalesce(p_brand, '')), '\s+', ' ', 'g')) || '|' ||
         coalesce(trim_scale(p_pack_amount * case p_pack_unit when 'kg' then 1000 when 'l' then 1000 else 1 end)::text
                  || case p_pack_unit when 'kg' then 'g' when 'l' then 'ml' else p_pack_unit end, '')
$$;

revoke all on function public.normalize_ean(text)          from public, anon, authenticated;
revoke all on function public.receipt_name_key(text)       from public, anon, authenticated;
revoke all on function public.receipt_scope(text, text)    from public, anon, authenticated;
revoke all on function public.product_identity_key(text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.normalize_ean(text)       to anon, authenticated;
grant execute on function public.receipt_name_key(text)    to anon, authenticated;
grant execute on function public.receipt_scope(text, text) to anon, authenticated;
grant execute on function public.product_identity_key(text, text, numeric, text) to anon, authenticated;

-- ── Товари ─────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  -- Рівно один тип: від нього залежить, яким рецептам пачка підходить.
  type_key        text not null check (type_key ~ '^[a-z][a-z0-9_]*$'),
  -- Назва — рівно те, що бачить людина. Бренд і жирність — підказки для
  -- пошуку й дублікатів; назву з них автоматично не складаємо.
  name            text not null check (char_length(btrim(name)) between 2 and 120),
  brand           text check (brand is null or char_length(btrim(brand)) between 1 and 60),
  fat_pct         numeric(4,1)  check (fat_pct is null or fat_pct between 0 and 100),
  -- Упаковка окремо від назви («· 900 мл»): з неї комора рахує, скільки лишилось.
  pack_amount     numeric(10,2) check (pack_amount is null or (pack_amount > 0 and pack_amount <= 100000)),
  pack_unit       text check (pack_unit is null or pack_unit in ('g','kg','ml','l','pcs')),
  grams_per_piece numeric(10,2) check (grams_per_piece is null or grams_per_piece > 0),
  -- КБЖВ на 100 г з етикетки; порожнє — беремо з типу.
  kcal            numeric(6,1) check (kcal    is null or kcal    between 0 and 900),
  protein         numeric(5,1) check (protein is null or protein between 0 and 100),
  fat             numeric(5,1) check (fat     is null or fat     between 0 and 100),
  carbs           numeric(5,1) check (carbs   is null or carbs   between 0 and 100),
  image_url       text check (image_url is null or image_url ~ '^https://'),
  source          text not null default 'user' check (source in ('user','off','receipt','migration')),
  -- «Прибрати картку» замість видалення: вандалізм чи помилку можна повернути.
  archived        boolean not null default false,
  -- Обʼєднаний дублікат (community-merge.sql): рядки комори й коди йдуть до переможця.
  merged_into     uuid references public.products (id),
  version         integer not null default 1,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now(),
  search_key      text generated always as
    (lower(regexp_replace(btrim(name || ' ' || coalesce(brand, '')), '\s+', ' ', 'g'))) stored,
  identity_key    text generated always as
    (public.product_identity_key(name, brand, pack_amount, pack_unit)) stored,
  constraint products_pack_pair        check ((pack_amount is null) = (pack_unit is null)),
  constraint products_nutrition_whole  check (kcal is not null or (protein is null and fat is null and carbs is null)),
  constraint products_macros           check (coalesce(protein,0) + coalesce(fat,0) + coalesce(carbs,0) <= 105),
  constraint products_not_self_merged  check (merged_into is null or merged_into <> id)
);

-- Дублікат ніколи не тихий: друга така сама картка впирається сюди, і
-- save_product відповідає «Такий товар уже є: … Це він?».
create unique index if not exists products_identity_uniq on public.products (identity_key)
  where merged_into is null and not archived;
create index if not exists products_type_idx    on public.products (type_key) where merged_into is null and not archived;
create index if not exists products_search_trgm on public.products using gin (search_key public.gin_trgm_ops);

-- Запобіжник картки. Invoker: читає лише каталоги типів, відкриті всім.
create or replace function public.products_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    -- Видалення профілю обнуляє created_by/updated_by окремим UPDATE від «on delete
    -- set null». Це не правка: ні версії, ні автора назад — інакше видалення акаунта
    -- падало б на ключі. Лише вкладений виклик (дія ключа) і лише обнулення.
    -- search_key/identity_key у NEW до BEFORE-тригера ще не пораховані (null) — не порівнюємо.
    if pg_trigger_depth() > 1
       and to_jsonb(new) - array['created_by', 'updated_by', 'search_key', 'identity_key']
         = to_jsonb(old) - array['created_by', 'updated_by', 'search_key', 'identity_key']
       and (new.created_by is null or new.created_by = old.created_by)
       and (new.updated_by is null or new.updated_by is not distinct from old.updated_by) then
      return new;
    end if;
    new.id := old.id; new.created_by := old.created_by; new.created_at := old.created_at;
    new.version := old.version + 1;
    -- Обʼєднання міняє лише merge_products / unmerge_product (nyam.merge = on).
    if nullif(current_setting('nyam.merge', true), '') is distinct from 'on' then
      new.merged_into := old.merged_into;
    end if;
  else
    new.created_by := auth.uid();
    new.created_at := now();
    new.version := 1;
    new.merged_into := null;
    new.archived := false;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();

  -- Тип мусить існувати: одруківка чи вандальна правка інакше переписала б
  -- тип рядків комори в усіх, у кого цей товар (products_type_to_pantry, I4).
  if tg_op = 'INSERT' or new.type_key is distinct from old.type_key then
    if not exists (select 1 from public.builtin_ingredients b where b.key = new.type_key)
       and not exists (select 1 from public.custom_ingredients c where c.key = new.type_key) then
      raise exception 'Немає типу %', new.type_key using errcode = '23503';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists products_guard on public.products;
create trigger products_guard before insert or update on public.products
  for each row execute function public.products_guard();

-- ── Ідентифікатори: штрихкод або назва з чека → товар або тип ─────────────
create table if not exists public.product_identifiers (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('ean', 'receipt_name')),
  -- '' = глобально. receipt_name: 'm:<мережа>' або 's:<ключ продавця>', коли продавець відомий.
  scope       text not null default '' check (scope ~ '^(|m:[a-z0-9_]{2,24}|s:.{1,60})$'),
  raw         text not null check (char_length(raw) between 1 and 200),
  value       text not null,                          -- рахує тригер із raw; клієнту не віримо
  product_id  uuid references public.products (id),
  type_key    text check (type_key is null or type_key ~ '^[a-z][a-z0-9_]*$'),
  source      text not null default 'manual' check (source in ('scan','qr','photo','manual','migration')),
  merged_from uuid,                                   -- де був до обʼєднання (для unmerge_product)
  version     integer not null default 1,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint product_identifiers_target     check ((product_id is null) <> (type_key is null)),
  constraint product_identifiers_ean_global check (kind <> 'ean' or scope = ''),
  constraint product_identifiers_uniq       unique (kind, scope, value)
);
create index if not exists product_identifiers_product_idx on public.product_identifiers (product_id) where product_id is not null;
create index if not exists product_identifiers_value_idx   on public.product_identifiers (kind, value);

create or replace function public.product_identifiers_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    -- Як у products_guard: видалення профілю обнуляє created_by/updated_by окремим UPDATE від «on delete
    -- set null». Це не правка: ні версії, ні автора назад — інакше видалення акаунта
    -- падало б на ключі. Лише вкладений виклик (дія ключа) і лише обнулення.
    if pg_trigger_depth() > 1
       and to_jsonb(new) - 'created_by' - 'updated_by' = to_jsonb(old) - 'created_by' - 'updated_by'
       and (new.created_by is null or new.created_by = old.created_by)
       and (new.updated_by is null or new.updated_by is not distinct from old.updated_by) then
      return new;
    end if;
    -- Що це за код і де його бачили — незмінне; міняється лише, на що він вказує.
    new.id := old.id; new.kind := old.kind; new.scope := old.scope; new.raw := old.raw;
    new.created_by := old.created_by; new.created_at := old.created_at;
    new.version := old.version + 1;
  else
    new.version := 1;
    new.created_at := now();
    if nullif(current_setting('nyam.merge', true), '') is distinct from 'on' then
      new.merged_from := null;
    end if;
  end if;
  -- value завжди з raw: і клієнт не підсуне свій ключ, і нова версія ключа
  -- перераховується простим update без зміни raw.
  new.value := case new.kind when 'ean' then public.normalize_ean(new.raw) else public.receipt_name_key(new.raw) end;
  if new.value is null then
    raise exception 'Це не схоже на штрихкод чи назву з чека: %', left(new.raw, 60) using errcode = '22023';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();

  if new.product_id is not null and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id) then
    if not exists (select 1 from public.products p
                    where p.id = new.product_id and p.merged_into is null and not p.archived) then
      raise exception 'Цю картку прибрали або обʼєднали з іншою' using errcode = '23514';
    end if;
  end if;
  if new.type_key is not null and (tg_op = 'INSERT' or new.type_key is distinct from old.type_key) then
    if not exists (select 1 from public.builtin_ingredients b where b.key = new.type_key)
       and not exists (select 1 from public.custom_ingredients c where c.key = new.type_key) then
      raise exception 'Немає типу %', new.type_key using errcode = '23503';
    end if;
  end if;
  -- Перепривʼязка поза обʼєднанням — свідоме рішення людини: unmerge_product
  -- такий код назад не забирає.
  if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id
     and nullif(current_setting('nyam.merge', true), '') is distinct from 'on' then
    new.merged_from := null;
  end if;
  return new;
end $$;
drop trigger if exists product_identifiers_guard on public.product_identifiers;
create trigger product_identifiers_guard before insert or update on public.product_identifiers
  for each row execute function public.product_identifiers_guard();

-- ── Історія спільних правок ────────────────────────────────────────────────
create table if not exists public.community_changes (
  id            bigint generated always as identity primary key,
  table_name    text not null check (table_name in ('products','product_identifiers','custom_ingredients')),
  row_id        text not null,
  op            text not null check (op in ('insert','update','delete','merge','unmerge')),
  changed_by    uuid references public.profiles (id) on delete set null,
  changed_at    timestamptz not null default now(),
  before        jsonb,
  after         jsonb,
  reverted_from bigint references public.community_changes (id)
);
create index if not exists community_changes_row_idx  on public.community_changes (table_name, row_id, id desc);
create index if not exists community_changes_user_idx on public.community_changes (changed_by, changed_at desc);

-- tg_argv[0] — назва ключової колонки: 'id' | 'key'.
-- Без стелі змін усередині: тригер, що відмовляє, обривав би RPC посередині.
-- Стелю тримає community_budget на вході в кожну RPC.
create or replace function public.audit_community_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Автор лежить у changed_by; у знімках його не тримаємо (не зануляється при видаленні профілю).
  b jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'created_by' - 'updated_by' end;
  a jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'created_by' - 'updated_by' end;
  noise text[] := array['version','updated_at','search_key','identity_key'];
begin
  if tg_op = 'UPDATE' and (b - noise) = (a - noise) then return null; end if;   -- повтори без змін не пишемо
  -- nullif(…, ''): у пулі зʼєднань змінна після чужої транзакції — '', а не null.
  insert into public.community_changes (table_name, row_id, op, changed_by, before, after, reverted_from)
  values (tg_table_name, coalesce(a, b) ->> tg_argv[0],
          coalesce(nullif(current_setting('nyam.change_op', true), ''), lower(tg_op)),
          auth.uid(), b, a, nullif(current_setting('nyam.revert_of', true), '')::bigint);
  return null;
end $$;

drop trigger if exists products_audit on public.products;
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit_community_change('id');
drop trigger if exists product_identifiers_audit on public.product_identifiers;
create trigger product_identifiers_audit after insert or update or delete on public.product_identifiers
  for each row execute function public.audit_community_change('id');
drop trigger if exists custom_ingredients_audit on public.custom_ingredients;
create trigger custom_ingredients_audit after insert or update or delete on public.custom_ingredients
  for each row execute function public.audit_community_change('key');

-- ── Внутрішні помічники ────────────────────────────────────────────────────

-- Стеля змін: 400 за 10 хвилин на людину. Чесному користувачеві не
-- дотягнутись і великим чеком (60 рядків), а вандала зупиняє за хвилину.
create or replace function public.community_budget(p_writes int)
returns void language plpgsql security definer set search_path = public as $$
declare used int;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  select count(*) into used from public.community_changes
   where changed_by = auth.uid() and changed_at > now() - interval '10 minutes';
  if used + greatest(coalesce(p_writes, 1), 0) > 400 then
    raise exception 'Забагато змін поспіль — спробуй за кілька хвилин'
      using errcode = 'P0001', hint = 'catalog_rate_limit';
  end if;
end $$;

-- Картка в тій формі, яку клієнту дозволено бачити (PRODUCT_SELECT): без
-- авторів, часу створення й службових ключів.
create or replace function public.product_client_json(p public.products)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'type_key', p.type_key, 'name', p.name, 'brand', p.brand, 'fat_pct', p.fat_pct,
    'pack_amount', p.pack_amount, 'pack_unit', p.pack_unit, 'grams_per_piece', p.grams_per_piece,
    'kcal', p.kcal, 'protein', p.protein, 'fat', p.fat, 'carbs', p.carbs, 'image_url', p.image_url,
    'source', p.source, 'archived', p.archived, 'merged_into', p.merged_into, 'version', p.version,
    'updated_at', p.updated_at)
$$;

-- Те саме для ідентифікатора (IDENTIFIER_SELECT).
create or replace function public.identifier_client_json(i public.product_identifiers)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', i.id, 'kind', i.kind, 'scope', i.scope, 'raw', i.raw, 'value', i.value,
    'product_id', i.product_id, 'type_key', i.type_key, 'source', i.source, 'version', i.version)
$$;

-- Застаріла версія чи рядка немає — дві різні відповіді людині.
create or replace function public.catalog_stale_or_missing(p_table text, p_id text)
returns void language plpgsql stable set search_path = public as $$
declare found_row boolean;
begin
  execute format('select exists (select 1 from public.%I where %I::text = $1)', p_table,
                 case p_table when 'custom_ingredients' then 'key' else 'id' end)
    into found_row using p_id;
  if found_row then
    raise exception 'Картку щойно змінили — онови й спробуй ще раз'
      using errcode = '40001', hint = 'catalog_conflict';
  end if;
  raise exception 'Такої картки немає' using errcode = 'P0002';
end $$;

revoke all on function public.community_budget(int)                          from public, anon, authenticated;
revoke all on function public.product_client_json(public.products)           from public, anon, authenticated;
revoke all on function public.identifier_client_json(public.product_identifiers) from public, anon, authenticated;
revoke all on function public.catalog_stale_or_missing(text, text)           from public, anon, authenticated;
-- Тригерні функції як RPC не викликаються, але права за замовчуванням їх відкривають.
revoke all on function public.products_guard()            from public, anon, authenticated;
revoke all on function public.product_identifiers_guard() from public, anon, authenticated;
revoke all on function public.audit_community_change()    from public, anon, authenticated;

-- ── Читання (invoker: бачать рівно те, що дозволяють grant-и й RLS) ───────

-- Що база знає про штрихкоди й назви одного чека — один запит на весь чек.
-- Порядок: область цього магазину → глобально → чужі області, лише якщо всі
-- вони одностайні (інакше «Молоко 900» з АТБ підмінило б сільпівське).
create or replace function public.resolve_identifiers(
  p_eans text[], p_names text[], p_seller text default null, p_chain text default null)
returns table (kind text, raw text, identifier_id uuid, scope text, product_id uuid, type_key text, version int)
language sql stable set search_path = public as $$
  with s as (select public.receipt_scope(p_seller, p_chain) as scope),
  wanted as (
    select 'ean'::text as kind, r as raw, public.normalize_ean(r) as value
      from unnest((coalesce(p_eans, '{}'))[1:200]) r
    union
    select 'receipt_name', r, public.receipt_name_key(r)
      from unnest((coalesce(p_names, '{}'))[1:200]) r
  ), hits as (
    select w.kind, w.raw, i.id, i.scope, coalesce(p.merged_into, i.product_id) as product_id, i.type_key, i.version,
           case when i.scope = s.scope then 0 when i.scope = '' then 1 else 2 end as rank
      from wanted w
      cross join s
      join public.product_identifiers i on i.kind = w.kind and i.value = w.value
      left join public.products p on p.id = i.product_id
     where w.value is not null and (i.product_id is null or not p.archived)
  ), agree as (
    select h.kind, h.raw, count(distinct coalesce(h.product_id::text, h.type_key)) as targets
      from hits h group by h.kind, h.raw
  )
  select distinct on (h.kind, h.raw) h.kind, h.raw, h.id, h.scope, h.product_id, h.type_key, h.version
    from hits h join agree a using (kind, raw)
   where h.rank < 2 or a.targets = 1          -- чужі області лише одностайні
   order by h.kind, h.raw, h.rank
$$;

-- Пошук карток для пікера й «Можливо, це вже є:». Індексовані умови —
-- like найдовшого слова або <% (обидві бере trigram GIN); like all по всіх
-- словах індекс не бере, тож він лише перевірка.
create or replace function public.search_products(p_query text, p_type_keys text[] default null, p_limit int default 20)
returns table (id uuid, type_key text, name text, brand text, fat_pct numeric, pack_amount numeric, pack_unit text,
               grams_per_piece numeric, kcal numeric, protein numeric, fat numeric, carbs numeric,
               image_url text, source text, archived boolean, merged_into uuid, version int, updated_at timestamptz)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare
  v_text text := lower(btrim(coalesce(p_query, '')));
  v_pats text[];
begin
  select array_agg('%' || replace(replace(t, '%', '\%'), '_', '\_') || '%' order by char_length(t) desc)
    into v_pats
    from regexp_split_to_table(v_text, '[^0-9a-zа-яёіїєґ]+') t
   where char_length(t) >= 2;
  if v_pats is null then return; end if;
  perform set_config('pg_trgm.word_similarity_threshold', '0.4', true);
  return query
    select p.id, p.type_key, p.name, p.brand, p.fat_pct, p.pack_amount, p.pack_unit, p.grams_per_piece,
           p.kcal, p.protein, p.fat, p.carbs, p.image_url, p.source, p.archived, p.merged_into, p.version, p.updated_at
      from public.products p
     where p.merged_into is null and not p.archived
       and (p_type_keys is null or p.type_key = any (p_type_keys))
       and (p.search_key like v_pats[1] or v_text <% p.search_key)          -- індексовані умови
       and (p.search_key like all (v_pats) or v_text <% p.search_key)       -- перевірка всіх слів
     order by (p.search_key like all (v_pats)) desc, word_similarity(v_text, p.search_key) desc, p.updated_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

revoke all on function public.resolve_identifiers(text[], text[], text, text) from public, anon, authenticated;
revoke all on function public.search_products(text, text[], int)             from public, anon, authenticated;
grant execute on function public.resolve_identifiers(text[], text[], text, text) to anon, authenticated;
grant execute on function public.search_products(text, text[], int)             to anon, authenticated;

-- ── Правки карток ──────────────────────────────────────────────────────────

-- Створити (p_id = null) або виправити картку. p_card читаємо лише за
-- білим списком ключів; «migration» — лише для SQL-файлів, не для клієнта.
create or replace function public.save_product(p_id uuid, p_expected_version int, p_card jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row   public.products;
  v_name  text;
  v_brand text;
  v_src   text;
  v_pack_amount numeric;
  v_pack_unit   text;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_card is null or jsonb_typeof(p_card) <> 'object' then
    raise exception 'Порожня картка' using errcode = '22023';
  end if;
  -- Без типу картка нікому не підходить. Не 23503 від запобіжника («такого
  -- типу вже немає» — людині порадили б оновити застосунок), а помилка форми.
  if nullif(btrim(coalesce(p_card->>'type_key', '')), '') is null then
    raise exception 'Обери тип товару' using errcode = '22023';
  end if;
  perform public.community_budget(1);

  v_name  := nullif(btrim(regexp_replace(coalesce(p_card->>'name', ''), '\s+', ' ', 'g')), '');
  v_brand := nullif(btrim(regexp_replace(coalesce(p_card->>'brand', ''), '\s+', ' ', 'g')), '');
  v_src   := case when p_card->>'source' in ('off', 'receipt') then p_card->>'source' else 'user' end;
  v_pack_amount := (p_card->>'pack_amount')::numeric;
  v_pack_unit   := nullif(p_card->>'pack_unit', '');

  if p_id is null then
    insert into public.products as t (type_key, name, brand, fat_pct, pack_amount, pack_unit, grams_per_piece,
                                      kcal, protein, fat, carbs, image_url, source)
    values (p_card->>'type_key', v_name, v_brand, (p_card->>'fat_pct')::numeric, v_pack_amount, v_pack_unit,
            (p_card->>'grams_per_piece')::numeric, (p_card->>'kcal')::numeric, (p_card->>'protein')::numeric,
            (p_card->>'fat')::numeric, (p_card->>'carbs')::numeric, nullif(p_card->>'image_url', ''), v_src)
    on conflict (identity_key) where merged_into is null and not archived do nothing
    returning * into v_row;
    if found then
      return jsonb_build_object('status', 'created', 'product', public.product_client_json(v_row));
    end if;
    -- Такий товар уже є — нічого не пишемо, людину спитають «Це він?».
    select * into v_row from public.products p
     where p.identity_key = public.product_identity_key(v_name, v_brand, v_pack_amount, v_pack_unit)
       and p.merged_into is null and not p.archived;
    return jsonb_build_object('status', 'duplicate', 'product', public.product_client_json(v_row));
  end if;

  if p_expected_version is null then
    raise exception 'Бракує номера версії картки' using errcode = '22023';
  end if;
  begin
    update public.products p
       set type_key = p_card->>'type_key', name = v_name, brand = v_brand,
           fat_pct = (p_card->>'fat_pct')::numeric, pack_amount = v_pack_amount, pack_unit = v_pack_unit,
           grams_per_piece = (p_card->>'grams_per_piece')::numeric, kcal = (p_card->>'kcal')::numeric,
           protein = (p_card->>'protein')::numeric, fat = (p_card->>'fat')::numeric,
           carbs = (p_card->>'carbs')::numeric, image_url = nullif(p_card->>'image_url', '')
           -- source не чіпаємо: правка людиною не робить OFF-картку «вигаданою».
     where p.id = p_id and p.version = p_expected_version and not p.archived and p.merged_into is null
    returning * into v_row;
  exception when unique_violation then
    -- Перейменування влучило в іншу картку — це дублікат, а не помилка.
    select * into v_row from public.products p
     where p.identity_key = public.product_identity_key(v_name, v_brand, v_pack_amount, v_pack_unit)
       and p.merged_into is null and not p.archived and p.id <> p_id;
    return jsonb_build_object('status', 'duplicate', 'product', public.product_client_json(v_row));
  end;
  if not found then
    if exists (select 1 from public.products p where p.id = p_id and (p.archived or p.merged_into is not null)) then
      raise exception 'Картку прибрали або обʼєднали — онови її' using errcode = '40001', hint = 'catalog_conflict';
    end if;
    perform public.catalog_stale_or_missing('products', p_id::text);
  end if;
  return jsonb_build_object('status', 'updated', 'product', public.product_client_json(v_row));
end $$;

-- «Прибрати картку для всіх» і «Повернути». Комори не чіпає: рядки лишаються
-- з product_id і назвою й далі читаються за id.
create or replace function public.set_product_archived(p_id uuid, p_expected_version int, p_archived boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.products;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_id is null or p_expected_version is null or p_archived is null then
    raise exception 'Бракує картки чи версії' using errcode = '22023';
  end if;
  perform public.community_budget(1);
  select * into v_row from public.products p where p.id = p_id and p.version = p_expected_version for update;
  if not found then perform public.catalog_stale_or_missing('products', p_id::text); end if;
  -- Вже так — версію не крутимо й історію не засмічуємо.
  if v_row.archived = p_archived then return public.product_client_json(v_row); end if;
  begin
    update public.products p set archived = p_archived where p.id = p_id returning * into v_row;
  exception when unique_violation then
    raise exception 'Така картка вже є — обʼєднай їх' using errcode = 'P0001', hint = 'duplicate';
  end;
  return public.product_client_json(v_row);
end $$;

-- ── Навчання кодів і назв ──────────────────────────────────────────────────

-- Вставити, якщо такого ще немає; чуже не переписує НІКОЛИ. Відповідь на
-- кожен рядок: inserted | same (уже вказує туди ж) | conflict (вказує на інше,
-- із версією для «Виправити для всіх») | skipped (only_if_unknown, а код
-- уже десь відомий) | invalid (ключ не рахується).
create or replace function public.teach_identifiers(p_items jsonb, p_seller text default null, p_chain text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scope text := public.receipt_scope(p_seller, p_chain);
  v_out   jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_kind  text;
  v_raw   text;
  v_value text;
  v_pid   uuid;
  v_type  text;
  v_src   text;
  v_row_scope text;
  v_row   public.product_identifiers;
  v_status text;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Очікували список рядків' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 60 then
    raise exception 'Забагато рядків за раз' using errcode = '22023';
  end if;
  perform public.community_budget(jsonb_array_length(p_items));

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := v_item->>'kind';
    v_raw  := v_item->>'raw';
    v_pid  := null;
    v_type := nullif(v_item->>'type_key', '');
    -- Обʼєднаний дописаний тип (community-merge.sql) у базі завжди записаний
    -- переможцем (тригер), тож і порівнюємо з канонічним ключем: клієнт, що ще
    -- тримає переможений own_*, інакше отримав би «conflict» проти того самого
    -- типу. Динамічно: до community-merge.sql функції ще немає.
    if v_type is not null and to_regprocedure('public.canonical_type_key(text)') is not null then
      execute 'select public.canonical_type_key($1)' into v_type using v_type;
    end if;
    v_status := null;
    v_row := null;
    v_value := case v_kind when 'ean' then public.normalize_ean(v_raw)
                           when 'receipt_name' then public.receipt_name_key(v_raw) end;
    v_row_scope := case v_kind when 'ean' then '' else v_scope end;

    if jsonb_typeof(v_item) <> 'object' or v_value is null or char_length(v_raw) > 200
       or ((v_item->>'product_id') is null) = (v_type is null)
       or (v_item->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_status := 'invalid';
    end if;

    if v_status is null and (v_item->>'product_id') is not null then
      -- Кеш клієнта міг тримати переможену картку — вчимо на переможця.
      select coalesce(p.merged_into, p.id) into v_pid from public.products p where p.id = (v_item->>'product_id')::uuid;
      if v_pid is null then raise exception 'Такої картки немає' using errcode = 'P0002'; end if;
      -- Картку тим часом прибрали: цей рядок не вчимо, але решту чека — так.
      -- Запобіжник (23514) обірвав би всю пачку через один рядок.
      if exists (select 1 from public.products p where p.id = v_pid and p.archived) then
        v_status := 'invalid';
      end if;
    end if;

    if v_status is null and v_item->'only_if_unknown' = 'true'::jsonb
       and exists (select 1 from public.product_identifiers i where i.kind = v_kind and i.value = v_value) then
      v_status := 'skipped';
    end if;

    if v_status is null then
      v_src := case when v_item->>'source' in ('scan', 'qr', 'photo', 'manual') then v_item->>'source' else 'manual' end;
      insert into public.product_identifiers as t (kind, scope, raw, product_id, type_key, source, created_by)
      values (v_kind, v_row_scope, v_raw, v_pid, v_type, v_src, auth.uid())
      on conflict (kind, scope, value) do nothing
      returning * into v_row;
      if found then
        v_status := 'inserted';
      else
        select * into v_row from public.product_identifiers i
         where i.kind = v_kind and i.scope = v_row_scope and i.value = v_value;
        v_status := case when v_row.product_id is not distinct from v_pid and v_row.type_key is not distinct from v_type
                         then 'same' else 'conflict' end;
      end if;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', v_kind, 'raw', v_raw, 'status', v_status, 'identifier_id', v_row.id,
      'scope', coalesce(v_row.scope, case when v_status in ('invalid', 'skipped') then null else v_row_scope end),
      'product_id', v_row.product_id, 'type_key', v_row.type_key, 'version', v_row.version));
  end loop;
  return v_out;
end $$;

-- «Виправити для всіх» і автоматичне уточнення тип → товар цього типу.
create or replace function public.reassign_identifier(p_id uuid, p_expected_version int, p_product_id uuid, p_type_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.product_identifiers; v_pid uuid;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_id is null or p_expected_version is null or (p_product_id is null) = (nullif(p_type_key, '') is null) then
    raise exception 'Код має вказувати або на товар, або на тип' using errcode = '22023';
  end if;
  perform public.community_budget(1);
  if p_product_id is not null then
    select coalesce(p.merged_into, p.id) into v_pid from public.products p where p.id = p_product_id;
    if v_pid is null then raise exception 'Такої картки немає' using errcode = 'P0002'; end if;
  end if;
  update public.product_identifiers i
     set product_id = v_pid, type_key = nullif(p_type_key, '')
   where i.id = p_id and i.version = p_expected_version
  returning * into v_row;
  if not found then perform public.catalog_stale_or_missing('product_identifiers', p_id::text); end if;
  return public.identifier_client_json(v_row);
end $$;

-- «Прибрати цей код». Пишеться в історію — його можна повернути.
create or replace function public.delete_identifier(p_id uuid, p_expected_version int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_id is null or p_expected_version is null then
    raise exception 'Бракує коду чи версії' using errcode = '22023';
  end if;
  perform public.community_budget(1);
  delete from public.product_identifiers i where i.id = p_id and i.version = p_expected_version;
  if not found then perform public.catalog_stale_or_missing('product_identifiers', p_id::text); end if;
end $$;

-- ── Історія й повернення версій ────────────────────────────────────────────

-- Хто й коли правив. Для кодів і для створення картки автор і точний час
-- приховані: людина + час + код із магазину (чи нова картка) видали б, де й
-- коли вона купувала. Пізніші правки картки показують імʼя — це вікі.
create or replace function public.community_history(p_table text, p_row_id text, p_limit int default 50)
returns table (id bigint, op text, changed_at timestamptz, actor_name text, before jsonb, after jsonb, reverted_from bigint)
language plpgsql stable security definer set search_path = public as $$
declare hidden_cols text[] := array['created_at', 'updated_at', 'merged_from', 'search_key', 'identity_key'];
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_table is null or p_table not in ('products', 'product_identifiers', 'custom_ingredients') then
    raise exception 'Історії для «%» немає', coalesce(p_table, '') using errcode = '22023';
  end if;
  return query
    select c.id, c.op,
           case when c.table_name = 'product_identifiers' or (c.table_name = 'products' and c.op = 'insert')
                then date_trunc('day', c.changed_at) else c.changed_at end,
           case when c.table_name = 'product_identifiers' or (c.table_name = 'products' and c.op = 'insert')
                then null else pr.name end,
           c.before - hidden_cols, c.after - hidden_cols, c.reverted_from
      from public.community_changes c
      left join public.profiles pr on pr.id = c.changed_by
     where c.table_name = p_table and c.row_id = p_row_id
     order by c.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- «Повернути цю версію»: рядок стає рівним after цього запису (лише
-- колонки з білого списку). merged_into так не повертається — для цього
-- unmerge_product.
create or replace function public.restore_community_version(p_change_id bigint, p_expected_version int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_change public.community_changes;
  p public.products;
  i public.product_identifiers;
  c public.custom_ingredients;
  v_pid uuid;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  perform public.community_budget(1);
  select * into v_change from public.community_changes ch where ch.id = p_change_id;
  if not found or v_change.after is null then
    raise exception 'Цієї версії немає' using errcode = 'P0002';
  end if;
  perform set_config('nyam.revert_of', v_change.id::text, true);

  if v_change.table_name = 'products' then
    p := jsonb_populate_record(null::public.products, v_change.after);
    begin
      update public.products t
         set type_key = p.type_key, name = p.name, brand = p.brand, fat_pct = p.fat_pct,
             pack_amount = p.pack_amount, pack_unit = p.pack_unit, grams_per_piece = p.grams_per_piece,
             kcal = p.kcal, protein = p.protein, fat = p.fat, carbs = p.carbs, image_url = p.image_url,
             archived = p.archived
       where t.id = p.id and t.version = p_expected_version;
    exception when unique_violation then
      raise exception 'Така картка вже є — обʼєднай їх' using errcode = 'P0001', hint = 'duplicate';
    end;
    if not found then perform public.catalog_stale_or_missing('products', v_change.row_id); end if;

  elsif v_change.table_name = 'product_identifiers' then
    i := jsonb_populate_record(null::public.product_identifiers, v_change.after);
    if i.product_id is not null then
      select coalesce(x.merged_into, x.id) into v_pid from public.products x where x.id = i.product_id;
    end if;
    if exists (select 1 from public.product_identifiers t where t.id = i.id) then
      update public.product_identifiers t
         set product_id = v_pid, type_key = case when v_pid is null then i.type_key end
       where t.id = i.id and t.version = p_expected_version;
      if not found then perform public.catalog_stale_or_missing('product_identifiers', v_change.row_id); end if;
    else
      -- Код видалили — повертаємо той самий рядок. created_by порожній: хто
      -- повернув, той не навчив його першим.
      begin
        insert into public.product_identifiers (id, kind, scope, raw, product_id, type_key, source, created_by)
        values (i.id, i.kind, i.scope, i.raw, v_pid, case when v_pid is null then i.type_key end, i.source, null);
      exception when unique_violation then
        raise exception 'Цей код уже привʼязаний до іншого' using errcode = '23505';
      end;
    end if;

  elsif v_change.table_name = 'custom_ingredients' then
    c := jsonb_populate_record(null::public.custom_ingredients, v_change.after);
    -- Запобіжник дерева перевірить батька заново: з того часу дерево могло змінитись.
    update public.custom_ingredients t
       set label = c.label, emoji = c.emoji, cat = c.cat, aliases = c.aliases, staple = c.staple,
           grams_per_piece = c.grams_per_piece, grams_per_cup = c.grams_per_cup, default_unit = c.default_unit,
           kcal = c.kcal, protein = c.protein, fat = c.fat, carbs = c.carbs, parent_key = c.parent_key
     where t.key = c.key and t.version = p_expected_version;
    if not found then perform public.catalog_stale_or_missing('custom_ingredients', v_change.row_id); end if;

  else
    raise exception 'Невідома таблиця історії' using errcode = '22023';
  end if;

  perform set_config('nyam.revert_of', '', true);
end $$;

-- ── Дописані типи: правка для всіх — лише так, з історією ─────────────────
-- Створення лишається прямим insert (так пишуть і старі клієнти).
create or replace function public.save_custom_ingredient(p_key text, p_expected_version int, p_def jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.custom_ingredients;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_key is null or p_key !~ '^own_' or p_expected_version is null
     or p_def is null or jsonb_typeof(p_def) <> 'object' then
    raise exception 'Правити можна лише дописаний тип' using errcode = '22023';
  end if;
  perform public.community_budget(1);
  update public.custom_ingredients t
     set label           = btrim(coalesce(p_def->>'label', '')),
         emoji           = coalesce(nullif(p_def->>'emoji', ''), t.emoji),
         cat             = coalesce(nullif(p_def->>'cat', ''), t.cat),
         aliases         = case when jsonb_typeof(p_def->'aliases') = 'array'
                                then array(select jsonb_array_elements_text(p_def->'aliases')) else '{}' end,
         staple          = coalesce((p_def->>'staple')::boolean, false),
         grams_per_piece = (p_def->>'grams_per_piece')::numeric,
         grams_per_cup   = (p_def->>'grams_per_cup')::numeric,
         default_unit    = coalesce(nullif(p_def->>'default_unit', ''), t.default_unit),
         kcal            = (p_def->>'kcal')::numeric,
         protein         = (p_def->>'protein')::numeric,
         fat             = (p_def->>'fat')::numeric,
         carbs           = (p_def->>'carbs')::numeric,
         parent_key      = nullif(p_def->>'parent_key', '')
   where t.key = p_key and t.version = p_expected_version
  returning * into v_row;
  if not found then perform public.catalog_stale_or_missing('custom_ingredients', p_key); end if;
  return to_jsonb(v_row) - 'created_by' - 'updated_by' - 'created_at' - 'updated_at';
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.save_product(uuid, int, jsonb)',
    'public.set_product_archived(uuid, int, boolean)',
    'public.teach_identifiers(jsonb, text, text)',
    'public.reassign_identifier(uuid, int, uuid, text)',
    'public.delete_identifier(uuid, int)',
    'public.community_history(text, text, int)',
    'public.restore_community_version(bigint, int)',
    'public.save_custom_ingredient(text, int, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ── Права й RLS ────────────────────────────────────────────────────────────
alter table public.products            enable row level security;
alter table public.product_identifiers enable row level security;
alter table public.community_changes   enable row level security;

-- products: читають усі — але без авторів і часу створення. Пишуть лише RPC.
-- Через grant на колонки клієнт НІКОЛИ не робить select * (PRODUCT_SELECT).
revoke all on public.products from anon, authenticated;
grant select (id, type_key, name, brand, fat_pct, pack_amount, pack_unit, grams_per_piece,
              kcal, protein, fat, carbs, image_url, source, archived, merged_into, version, updated_at, search_key)
  on public.products to anon, authenticated;
drop policy if exists "products readable" on public.products;
create policy "products readable" on public.products for select using (true);

-- product_identifiers: без авторів і часу (приватність покупок).
revoke all on public.product_identifiers from anon, authenticated;
grant select (id, kind, scope, raw, value, product_id, type_key, source, version)
  on public.product_identifiers to anon, authenticated;
drop policy if exists "identifiers readable" on public.product_identifiers;
create policy "identifiers readable" on public.product_identifiers for select using (true);

-- community_changes: лише через community_history (сирі — службовому ключу, для модерації).
revoke all on public.community_changes from anon, authenticated;
revoke usage, select, update on sequence public.community_changes_id_seq from anon, authenticated;

-- custom_ingredients: вставка лишається прямою (так пишуть старі клієнти),
-- правка — лише save_custom_ingredient. Політика «update own» з family.sql без
-- цього права більше нічого не дозволяє.
revoke update on public.custom_ingredients from anon, authenticated;

-- ── «Схоже на: …» для назв із чека (receipt-learning.sql) ─────────────────
-- Лише назви з чека: штрихкоди шукаються точно.
create index if not exists product_identifiers_name_trgm on public.product_identifiers
  using gin (value public.gin_trgm_ops) where kind = 'receipt_name';

create or replace function public.similar_receipt_names(
  p_names text[], p_seller text default null, p_chain text default null)
returns table (raw text, identifier_id uuid, value text, similarity real, product_id uuid)
language sql stable set search_path = public as $$
  with s as (select public.receipt_scope(p_seller, p_chain) as scope)
  select distinct on (q.raw) q.raw, i.id, i.value, similarity(i.value, q.k), coalesce(p.merged_into, i.product_id)
    from (select r as raw, public.receipt_name_key(r) as k from unnest((coalesce(p_names, '{}'))[1:40]) r) q
    cross join s
    join public.product_identifiers i on i.kind = 'receipt_name' and i.value % q.k
    join public.products p on p.id = i.product_id and not p.archived
   where q.k is not null
     and similarity(i.value, q.k) >= 0.8
     -- Цифри мають збігтися повністю: 2.5% і 3.2%, 900 і 950 — різні товари.
     and regexp_replace(i.value, '[^0-9.%]', '', 'g') = regexp_replace(q.k, '[^0-9.%]', '', 'g')
   order by q.raw, (i.scope = s.scope) desc, similarity(i.value, q.k) desc
$$;

revoke all on function public.similar_receipt_names(text[], text, text) from public, anon, authenticated;
grant execute on function public.similar_receipt_names(text[], text, text) to authenticated;

-- ── Дописані типи: псевдонім ───────────────────────────────────────────────
-- Без FK: переможцем буває й вбудований тип (його немає в custom_ingredients).
alter table public.custom_ingredients add column if not exists merged_into text;
alter table public.custom_ingredients drop constraint if exists custom_ingredients_merged_fmt;
alter table public.custom_ingredients add constraint custom_ingredients_merged_fmt
  check (merged_into is null or (merged_into ~ '^[a-z][a-z0-9_]*$' and merged_into <> key));

-- Канонічний ключ типу: переможений дописаний тип → його переможець (один
-- крок — обʼєднання сплющує ланцюжки). Для вбудованих і звичайних — сам ключ.
create or replace function public.canonical_type_key(p_key text)
returns text language sql stable set search_path = public as $$
  select coalesce((select c.merged_into from public.custom_ingredients c where c.key = p_key), p_key)
$$;

-- Окремий тригер, а не правка custom_ingredients_guard: запобіжник дерева
-- лишається дослівно таким, як у ingredient-parents.sql і schema.sql, і
-- повторний запуск тих файлів цих правил не зітре. BEFORE-тригери однієї
-- таблиці йдуть за абеткою: «…_canonical» спрацьовує раніше за «…_guard»,
-- тож обхід дерева вже бачить канонічного батька.
create or replace function public.custom_ingredients_canonical()
returns trigger language plpgsql set search_path = public as $$
begin
  -- «on delete set null» від видалення профілю — не правка (див. custom_ingredients_guard).
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and to_jsonb(new) - 'created_by' - 'updated_by' = to_jsonb(old) - 'created_by' - 'updated_by' then
    return new;
  end if;
  if nullif(current_setting('nyam.merge', true), '') is distinct from 'on' then
    -- Прямий insert (так пишуть і старі клієнти) псевдонімом не робить.
    new.merged_into := case when tg_op = 'UPDATE' then old.merged_into end;
  end if;
  -- Батьком не буває переможений тип — лише його переможець.
  if new.parent_key is not null then
    new.parent_key := public.canonical_type_key(new.parent_key);
  end if;
  return new;
end $$;
drop trigger if exists custom_ingredients_canonical on public.custom_ingredients;
create trigger custom_ingredients_canonical before insert or update on public.custom_ingredients
  for each row execute function public.custom_ingredients_canonical();

-- Картки й коди з переможеним типом одразу пишуться на переможця: інакше
-- новий товар «own_kefir_bez_laktozy» знову розколов би пошук за типом.
-- «products_canonical_type» < «products_guard» за абеткою — спершу ключ, потім перевірка.
create or replace function public.catalog_canonical_type()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.type_key is not null then
    new.type_key := public.canonical_type_key(new.type_key);
  end if;
  return new;
end $$;
drop trigger if exists products_canonical_type on public.products;
create trigger products_canonical_type before insert or update of type_key on public.products
  for each row execute function public.catalog_canonical_type();
drop trigger if exists product_identifiers_canonical_type on public.product_identifiers;
create trigger product_identifiers_canonical_type before insert or update of type_key on public.product_identifiers
  for each row execute function public.catalog_canonical_type();

-- ── Сумісність типів ───────────────────────────────────────────────────────
-- Один тип — предок-або-сам другого (по вбудованих і дописаних разом).
-- «Молоко» й «Молоко безлактозне» — так; «Молоко» й «Кефір» — ні.
create or replace function public.types_compatible(p_a text, p_b text)
returns boolean language sql stable set search_path = public as $$
  with recursive tree as (
    select key, parent_key from public.builtin_ingredients
    union all
    select key, public.canonical_type_key(parent_key) from public.custom_ingredients where merged_into is null
  ), up (start, key, depth) as (
    select s, s, 0 from unnest(array[public.canonical_type_key(p_a), public.canonical_type_key(p_b)]) s
    union all
    select up.start, t.parent_key, up.depth + 1
      from up join tree t on t.key = up.key
     where t.parent_key is not null and up.depth < 12
  )
  select exists (select 1 from up where up.start = public.canonical_type_key(p_a) and up.key = public.canonical_type_key(p_b))
      or exists (select 1 from up where up.start = public.canonical_type_key(p_b) and up.key = public.canonical_type_key(p_a))
$$;

-- ── Обʼєднати картки ───────────────────────────────────────────────────────
create or replace function public.merge_products(p_loser uuid, p_winner uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.products;
  w public.products;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_loser is null or p_winner is null or p_loser = p_winner then
    raise exception 'Обери дві різні картки' using errcode = '22023';
  end if;
  perform public.community_budget(10);

  -- Блокуємо в сталому порядку: два зустрічні обʼєднання не заклинять одне одного.
  perform 1 from public.products p where p.id in (p_loser, p_winner) order by p.id for update;
  select * into l from public.products p where p.id = p_loser and p.merged_into is null and not p.archived;
  if not found then raise exception 'Цієї картки вже немає або її обʼєднано' using errcode = 'P0002'; end if;
  select * into w from public.products p where p.id = p_winner and p.merged_into is null and not p.archived;
  if not found then raise exception 'Цієї картки вже немає або її обʼєднано' using errcode = 'P0002'; end if;
  if not public.types_compatible(l.type_key, w.type_key) then
    raise exception 'Спершу зроби однаковий тип' using errcode = '23514';
  end if;
  /*
   * Стеля — за тим, що справді переїде: кожен код пишеться в історію окремим
   * записом, а рядки комори (чужі, без історії) міняє цей самий виклик. Пласка
   * ціна дала б картці з тисячею кодів переїхати одним викликом навіть на межі.
   */
  perform public.community_budget(10
    + (select count(*)::int from public.product_identifiers i where i.product_id = p_loser)
    + (select count(*)::int from public.products p where p.merged_into = p_loser)
    + (select count(*)::int from public.pantry_items pi where pi.product_id = p_loser));

  perform set_config('nyam.merge', 'on', true);
  perform set_config('nyam.change_op', 'merge', true);

  -- Коди переходять разом із памʼяттю, звідки прийшли (для unmerge_product).
  update public.product_identifiers i set product_id = p_winner, merged_from = p_loser
   where i.product_id = p_loser;

  -- Спершу переможений стає псевдонімом (і звільняє свою «назву+бренд+упаковку»),
  -- разом із тими, хто вже вказував на нього.
  update public.products p set merged_into = p_winner
   where p.id = p_loser or p.merged_into = p_loser;

  -- Дозаповнюємо переможця тим, чого бракує. КБЖВ — цілим блоком: половина
  -- з однієї етикетки, половина з іншої — неправда.
  update public.products p
     set kcal    = case when p.kcal is null then l.kcal    else p.kcal    end,
         protein = case when p.kcal is null then l.protein else p.protein end,
         fat     = case when p.kcal is null then l.fat     else p.fat     end,
         carbs   = case when p.kcal is null then l.carbs   else p.carbs   end,
         image_url = coalesce(p.image_url, l.image_url),
         grams_per_piece = coalesce(p.grams_per_piece, l.grams_per_piece)
   where p.id = p_winner;
  if w.pack_amount is null and l.pack_amount is not null then
    begin
      update public.products p set pack_amount = l.pack_amount, pack_unit = l.pack_unit where p.id = p_winner;
    exception when unique_violation then
      null;   -- з такою упаковкою вже є третя картка — упаковку не беремо, решта лишається
    end;
  end if;

  -- Приватні рядки комори — не в історію; тип підтягне тригер комори.
  update public.pantry_items pi set product_id = p_winner where pi.product_id = p_loser;

  perform set_config('nyam.merge', '', true);
  perform set_config('nyam.change_op', '', true);
  select * into w from public.products p where p.id = p_winner;
  return public.product_client_json(w);
end $$;

-- ── Розʼєднати ─────────────────────────────────────────────────────────────
-- Повертає рівно ті коди, що переїхали при обʼєднанні й досі на переможці.
-- Код, який після обʼєднання хтось свідомо перепривʼязав, лишається там, де є.
-- Рядки комори лишаються з переможцем: хто їх додав, той бачив саме його.
create or replace function public.unmerge_product(p_loser uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.products;
  v_winner uuid;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  perform public.community_budget(10);
  select * into l from public.products p where p.id = p_loser and p.merged_into is not null for update;
  if not found then raise exception 'Ця картка не обʼєднана' using errcode = 'P0002'; end if;
  v_winner := l.merged_into;
  perform public.community_budget(10
    + (select count(*)::int from public.product_identifiers i where i.merged_from = p_loser and i.product_id = v_winner));

  perform set_config('nyam.merge', 'on', true);
  perform set_config('nyam.change_op', 'unmerge', true);
  begin
    update public.products p set merged_into = null where p.id = p_loser;
  exception when unique_violation then
    raise exception 'Така картка вже є — обʼєднай їх' using errcode = 'P0001', hint = 'duplicate';
  end;
  update public.product_identifiers i set product_id = p_loser, merged_from = null
   where i.merged_from = p_loser and i.product_id = v_winner;

  perform set_config('nyam.merge', '', true);
  perform set_config('nyam.change_op', '', true);
  select * into l from public.products p where p.id = p_loser;
  return public.product_client_json(l);
end $$;

-- ── Обʼєднати дописані типи ────────────────────────────────────────────────
-- Що саме переїхало при кожному обʼєднанні типів — щоб його можна було
-- розʼєднати рівно назад. Картки й коди є і в community_changes, але рядки
-- комори й списку покупок приватні: в історію, яку читає кожен, їм не можна,
-- а без них «Розʼєднати» лишило б чуже молоко кефіром. Тому окрема таблиця,
-- закрита для клієнтів повністю: читають і пишуть лише функції нижче.
create table if not exists public.custom_ingredient_merges (
  id            bigint generated always as identity primary key,
  loser         text not null,
  winner        text not null,
  -- Переможець був різновидом переможеного й отримав його батька.
  winner_lifted boolean not null default false,
  loser_parent  text,
  aliases       text[] not null default '{}',   -- типи, що вже вказували на переможеного
  children      text[] not null default '{}',   -- різновиди переможеного (крім переможця)
  products      uuid[] not null default '{}',
  identifiers   uuid[] not null default '{}',
  pantry        uuid[] not null default '{}',
  shopping      uuid[] not null default '{}',
  merged_by     uuid references public.profiles (id) on delete set null,
  merged_at     timestamptz not null default now(),
  undone_at     timestamptz
);
create index if not exists custom_ingredient_merges_loser_idx on public.custom_ingredient_merges (loser, id desc);
alter table public.custom_ingredient_merges enable row level security;
revoke all on public.custom_ingredient_merges from anon, authenticated;
revoke usage, select, update on sequence public.custom_ingredient_merges_id_seq from anon, authenticated;

-- Переможений — лише own_*: вбудовані живуть у коді. Рецептів не
-- переписуємо: canonicalKey() у застосунку читає старий ключ як новий.
--
-- Типи мусять бути сумісні: один — той самий чи загальніший за інший, або в
-- них спільний батько («Кефір безлактозний» і «Кефір без лактози» — обидва
-- різновиди «Кефіру»; два самостійні — теж). «Кефір безлактозний» у «Сіль» —
-- ні: інакше будь-хто одним викликом переписав би кефір на сіль у коморах і
-- списках усіх сімей. Розʼєднати можна (unmerge_custom_ingredient).
create or replace function public.merge_custom_ingredients(p_loser text, p_winner text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.custom_ingredients;
  v_winner_parent text;
  v_lifted boolean;
  v_aliases text[];
  v_children text[];
  v_products uuid[];
  v_identifiers uuid[];
  v_pantry uuid[];
  v_shopping uuid[];
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_loser is null or p_loser !~ '^own_' or p_winner is null or p_loser = p_winner then
    raise exception 'Обʼєднати можна лише дописаний тип з іншим' using errcode = '22023';
  end if;
  perform public.community_budget(10);

  perform pg_advisory_xact_lock(hashtext('nyam:ingredient-tree'));
  select * into l from public.custom_ingredients c where c.key = p_loser and c.merged_into is null for update;
  if not found then raise exception 'Цього типу вже немає або його обʼєднано' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.builtin_ingredients b where b.key = p_winner)
     and not exists (select 1 from public.custom_ingredients c where c.key = p_winner and c.merged_into is null) then
    raise exception 'Цього типу вже немає або його обʼєднано' using errcode = 'P0002';
  end if;
  -- Ключі вбудованих і дописаних не перетинаються (own_*), тож батько — з однієї з таблиць.
  v_winner_parent := coalesce(
    (select b.parent_key from public.builtin_ingredients b where b.key = p_winner),
    (select public.canonical_type_key(c.parent_key) from public.custom_ingredients c where c.key = p_winner));
  if not public.types_compatible(p_loser, p_winner)
     and public.canonical_type_key(l.parent_key) is distinct from v_winner_parent then
    raise exception 'Спершу зроби однаковий тип' using errcode = '23514';
  end if;

  /*
   * Стеля змін — за тим, що справді переїде, а не пласкою ціною: тип із
   * тисячею карток і рядків комори інакше переписувався б одним викликом
   * навіть на межі 400 змін. Рядки комори й списку в історію не йдуть, але
   * теж рахуються: це чужі записи, які міняє цей виклик.
   */
  perform public.community_budget(10
    + (select count(*)::int from public.custom_ingredients c where c.merged_into = p_loser or c.parent_key = p_loser)
    + (select count(*)::int from public.products p where p.type_key = p_loser)
    + (select count(*)::int from public.product_identifiers i where i.type_key = p_loser)
    + (select count(*)::int from public.pantry_items pi where pi.ingredient_key = p_loser)
    + (select count(*)::int from public.shopping_items si where si.ingredient_key = p_loser));

  perform set_config('nyam.merge', 'on', true);
  perform set_config('nyam.change_op', 'merge', true);

  -- Переможець був різновидом переможеного — піднімаємо його на місце
  -- переможеного, інакше вийшло б «тип — різновид самого себе».
  with u as (
    update public.custom_ingredients c set parent_key = l.parent_key
     where c.key = p_winner and c.parent_key = p_loser returning 1)
  select exists (select 1 from u) into v_lifted;

  with u as (
    update public.custom_ingredients c set merged_into = p_winner
     where c.merged_into = p_loser returning c.key)
  select coalesce(array_agg(key), '{}') into v_aliases from u;
  update public.custom_ingredients c set merged_into = p_winner where c.key = p_loser;
  -- Різновиди переможеного стають різновидами переможця (канонічний тригер).
  with u as (
    update public.custom_ingredients c set parent_key = p_winner
     where c.parent_key = p_loser returning c.key)
  select coalesce(array_agg(key), '{}') into v_children from u;

  -- Рядки комори з товаром цього типу переведе тригер products_type_to_pantry,
  -- і так само назад при розʼєднанні — окремо їх не памʼятаємо.
  with u as (update public.products p set type_key = p_winner where p.type_key = p_loser returning p.id)
  select coalesce(array_agg(id), '{}') into v_products from u;
  with u as (update public.product_identifiers i set type_key = p_winner where i.type_key = p_loser returning i.id)
  select coalesce(array_agg(id), '{}') into v_identifiers from u;
  -- Приватні рядки — без історії; RLS тут не діє (definer), це свідомо.
  with u as (update public.pantry_items pi set ingredient_key = p_winner where pi.ingredient_key = p_loser returning pi.id)
  select coalesce(array_agg(id), '{}') into v_pantry from u;
  with u as (update public.shopping_items si set ingredient_key = p_winner where si.ingredient_key = p_loser returning si.id)
  select coalesce(array_agg(id), '{}') into v_shopping from u;

  insert into public.custom_ingredient_merges
    (loser, winner, winner_lifted, loser_parent, aliases, children, products, identifiers, pantry, shopping, merged_by)
  values (p_loser, p_winner, v_lifted, l.parent_key, v_aliases, v_children, v_products, v_identifiers,
          v_pantry, v_shopping, auth.uid());

  perform set_config('nyam.merge', '', true);
  perform set_config('nyam.change_op', '', true);
end $$;

-- ── Розʼєднати типи ────────────────────────────────────────────────────────
-- Повертає рівно те, що переїхало при останньому обʼєднанні цього типу й
-- відтоді лишилось на переможці. Те, що після обʼєднання хтось свідомо змінив
-- (картку перевели в інший тип, рядок комори — в інший), лишається як є.
create or replace function public.unmerge_custom_ingredient(p_loser text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.custom_ingredient_merges;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_loser is null or p_loser !~ '^own_' then
    raise exception 'Розʼєднати можна лише дописаний тип' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('nyam:ingredient-tree'));
  select * into r from public.custom_ingredient_merges m
   where m.loser = p_loser and m.undone_at is null
   order by m.id desc limit 1 for update;
  -- Переможця відтоді обʼєднали ще з кимось — спершу розʼєднати його.
  if not found or not exists (select 1 from public.custom_ingredients c
                               where c.key = p_loser and c.merged_into = r.winner) then
    raise exception 'Цей тип не обʼєднаний (або його переможця обʼєднали далі)' using errcode = 'P0002';
  end if;
  perform public.community_budget(1 + cardinality(r.aliases) + cardinality(r.children) + cardinality(r.products)
                                  + cardinality(r.identifiers) + cardinality(r.pantry) + cardinality(r.shopping));

  perform set_config('nyam.merge', 'on', true);
  perform set_config('nyam.change_op', 'unmerge', true);

  -- Спершу сам тип: поки він псевдонім, канонічні тригери переписали б усе назад на переможця.
  update public.custom_ingredients c set merged_into = null where c.key = p_loser;
  update public.custom_ingredients c set merged_into = p_loser
   where c.key = any (r.aliases) and c.merged_into = r.winner;
  if r.winner_lifted then
    update public.custom_ingredients c set parent_key = p_loser
     where c.key = r.winner and c.parent_key is not distinct from r.loser_parent;
  end if;
  update public.custom_ingredients c set parent_key = p_loser
   where c.key = any (r.children) and c.parent_key = r.winner;

  update public.products p set type_key = p_loser where p.id = any (r.products) and p.type_key = r.winner;
  update public.product_identifiers i set type_key = p_loser where i.id = any (r.identifiers) and i.type_key = r.winner;
  update public.pantry_items pi set ingredient_key = p_loser where pi.id = any (r.pantry) and pi.ingredient_key = r.winner;
  update public.shopping_items si set ingredient_key = p_loser where si.id = any (r.shopping) and si.ingredient_key = r.winner;

  update public.custom_ingredient_merges m set undone_at = now() where m.id = r.id;
  perform set_config('nyam.merge', '', true);
  perform set_config('nyam.change_op', '', true);
end $$;

-- ── Права ──────────────────────────────────────────────────────────────────
revoke all on function public.custom_ingredients_canonical() from public, anon, authenticated;
revoke all on function public.catalog_canonical_type()       from public, anon, authenticated;
revoke all on function public.types_compatible(text, text)   from public, anon, authenticated;
-- canonical_type_key кличуть invoker-тригери від імені того, хто пише (і
-- старий клієнт, що вставляє дописаний тип напряму), — тож authenticated
-- мусить мати EXECUTE. Показує лише те, що й так видно в custom_ingredients.
revoke all on function public.canonical_type_key(text)       from public, anon, authenticated;
grant execute on function public.canonical_type_key(text)    to authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.merge_products(uuid, uuid)',
    'public.unmerge_product(uuid)',
    'public.merge_custom_ingredients(text, text)',
    'public.unmerge_custom_ingredient(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
--  Комора по товарах — контрактна форма (pantry-receipt-name.sql,
--  pantry-products.sql, pantry-products-contract.sql). Тимчасових тригерів для
--  старих застосунків (перенесення касового label, запис без id на «той самий»
--  рядок) тут немає й не буде: свіжа база старих клієнтів не має.
-- ════════════════════════════════════════════════════════════════════════════

-- updated_at веде база, а не клієнт: клієнт його не шле й не знає.
create or replace function public.pantry_items_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

-- Тип рядка = тип товару, завжди. Обʼєднаний товар (I6) — на канонічний.
-- Товару немає (без FK) — лишаємо як прислали. Читає лише відкриті всім
-- колонки products (id, merged_into, type_key), тож invoker.
create or replace function public.pantry_items_sync_product(r public.pantry_items)
returns public.pantry_items language plpgsql stable set search_path = public as $$
declare canon uuid; t text;
begin
  if r.product_id is null then return r; end if;
  select coalesce(p.merged_into, p.id) into canon from public.products p where p.id = r.product_id;
  if canon is null then return r; end if;
  select p.type_key into t from public.products p where p.id = canon;
  if t is null then return r; end if;
  r.product_id := canon; r.ingredient_key := t;
  return r;
end $$;

create or replace function public.pantry_items_before_update()
returns trigger language plpgsql set search_path = public as $$
begin
  new.id := old.id;
  new.user_id := old.user_id;          -- власник рядка не змінюється (як keep_shopping_owner)
  new := public.pantry_items_sync_product(new);
  return new;
end $$;

-- Єдиний свідомий запис у чужі рядки: спільнота виправила тип товару — рядки
-- всіх, у кого він є, знову збігаються з рецептами. Відкат правки повертає
-- тип так само. Definer: RLS комори не пустила б у чужі рядки.
create or replace function public.products_type_to_pantry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.pantry_items set ingredient_key = new.type_key
   where product_id = new.id and ingredient_key <> new.type_key;
  return null;
end $$;

revoke all on function public.pantry_items_touch()               from public, anon, authenticated;
revoke all on function public.pantry_items_before_update()   from public, anon, authenticated;
revoke all on function public.products_type_to_pantry()      from public, anon, authenticated;
-- Вкладений виклик із invoker-тригерів комори: EXECUTE перевіряється від того,
-- хто пише рядок. Закрити — і кожен запис у комору впаде з 42501.
revoke all on function public.pantry_items_sync_product(public.pantry_items) from public, anon;
grant execute on function public.pantry_items_sync_product(public.pantry_items) to authenticated;

/*
 * Тригери комори — лише коли таблиця вже в контрактній формі: у id є default.
 * Так є на свіжій базі (create table вище) і після pantry-products-contract.sql.
 *
 * На базі, створеній раніше, цей файл комору НЕ чіпає:
 *   - до pantry-products.sql колонок id/product_id ще немає, і тригери з
 *     new.id ламали б кожен запис;
 *   - між pantry-products.sql і контрактним кроком там стоїть тимчасовий
 *     pantry_items_before_insert для старих клієнтів (запис без id лягає на
 *     рядок, який вони показували). Контрактне тіло тут перетворило б кожну
 *     їхню правку на нову пачку-дублікат.
 * Тому повторний запуск schema.sql на живій базі безпечний на будь-якому етапі.
 */
do $do$
begin
  if not exists (select 1 from pg_attrdef d
                   join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                  where d.adrelid = 'public.pantry_items'::regclass and a.attname = 'id') then
    raise notice 'pantry_items ще не в контрактній формі — тригери комори веде supabase/pantry-receipt-name.sql і pantry-products.sql (див. README)';
    return;
  end if;

  -- Контрактне тіло — дослівно як у pantry-products-contract.sql.
  execute $fn$
create or replace function public.pantry_items_before_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id is null then new.id := gen_random_uuid(); end if;
  new := public.pantry_items_sync_product(new);
  return new;
end $$
$fn$;
  revoke all on function public.pantry_items_before_insert() from public, anon, authenticated;

  create index if not exists pantry_items_user_type_idx on public.pantry_items (user_id, ingredient_key);
  create index if not exists pantry_items_product_idx   on public.pantry_items (product_id) where product_id is not null;

  -- BEFORE-тригери однієї події йдуть за абеткою: before_insert/before_update
  -- (id, власник, тип) → touch.
  drop trigger if exists pantry_items_touch on public.pantry_items;
  create trigger pantry_items_touch before update on public.pantry_items
    for each row execute function public.pantry_items_touch();
  drop trigger if exists pantry_items_before_insert on public.pantry_items;
  create trigger pantry_items_before_insert before insert on public.pantry_items
    for each row execute function public.pantry_items_before_insert();
  drop trigger if exists pantry_items_before_update on public.pantry_items;
  create trigger pantry_items_before_update before update on public.pantry_items
    for each row execute function public.pantry_items_before_update();
  drop trigger if exists products_type_to_pantry on public.products;
  create trigger products_type_to_pantry after update of type_key on public.products
    for each row when (old.type_key is distinct from new.type_key)
    execute function public.products_type_to_pantry();

  -- Довідник штрихкодів заморожено: коди живуть у product_identifiers.
  -- Читати barcode_cache ще можна (старі дані), писати — ні.
  revoke insert, update on public.barcode_cache from anon, authenticated;
end $do$;

-- Профіль створюється автоматично при реєстрації користувача.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta          jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base_handle   text;
  final_handle  text;
  display_name  text;
  picture       text;
  suffix        int := 0;
begin
  -- Нік: латиниця з пошти, інакше 'chef'
  base_handle := nullif(
    regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9._]', '', 'g'),
    ''
  );
  base_handle := coalesce(base_handle, 'chef');
  final_handle := base_handle;

  while exists (select 1 from public.profiles where handle = final_handle) loop
    suffix := suffix + 1;
    final_handle := base_handle || suffix::text;
  end loop;

  -- Google кладе імʼя у full_name або name, аватар — в avatar_url або picture.
  display_name := coalesce(
    nullif(meta ->> 'full_name', ''),
    nullif(meta ->> 'name', ''),
    base_handle
  );
  picture := coalesce(nullif(meta ->> 'avatar_url', ''), nullif(meta ->> 'picture', ''));

  insert into public.profiles (id, handle, name, avatar_url)
  values (new.id, final_handle, display_name, picture)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Видалення акаунта прибирає профіль і весь контент.
create or replace function public.handle_deleted_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

drop trigger if exists on_auth_user_deleted on auth.users;
create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_deleted_user();

-- ── Row Level Security ─────────────────────────────────────────────────────
alter table public.profiles     enable row level security;
alter table public.recipes      enable row level security;
alter table public.likes        enable row level security;
alter table public.saves        enable row level security;
alter table public.wishlist     enable row level security;
alter table public.ratings      enable row level security;
alter table public.cooks        enable row level security;
alter table public.follows      enable row level security;
alter table public.pantry_items enable row level security;
alter table public.shopping_items enable row level security;
alter table public.plan_slots   enable row level security;
alter table public.dismissed    enable row level security;
alter table public.barcode_cache enable row level security;
alter table public.custom_ingredients enable row level security;

-- Профілі: читає будь-хто, редагує лише власник.
drop policy if exists "profiles readable"  on public.profiles;
drop policy if exists "profiles self write" on public.profiles;
create policy "profiles readable" on public.profiles for select using (true);
create policy "profiles self write" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

/*
 * Політики, які пізніші файли розширюють на сімʼю (family.sql,
 * custom-ingredients.sql, shopping.sql), тут створюються ЛИШЕ коли їх ще
 * немає. Цей файл дозволено запускати повторно на живій базі, і раніше
 * повторний запуск повертав вузькі версії: сімʼя переставала бачити приватні
 * рецепти одне одного й правити спільні продукти, а поруч із сімейними
 * політиками комори й плану знову зʼявлялись «… own». Змінювати такі
 * політики — у файлі, що їх розширює, а не тут.
 */

-- Рецепти: публічні бачать усі, приватні — лише автор (сімʼю додає family.sql).
drop policy if exists "recipes insert own"  on public.recipes;
drop policy if exists "recipes update own"  on public.recipes;
drop policy if exists "recipes delete own"  on public.recipes;
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'recipes' and policyname = 'recipes readable') then
    create policy "recipes readable" on public.recipes
      for select using (is_public or auth.uid() = author_id);
  end if;
end $$;
create policy "recipes insert own" on public.recipes
  for insert with check (auth.uid() = author_id);
create policy "recipes update own" on public.recipes
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy "recipes delete own" on public.recipes
  for delete using (auth.uid() = author_id);

-- Публічні взаємодії: агрегати бачать усі, пише кожен лише за себе.
do $$
declare t text;
begin
  foreach t in array array['likes', 'saves', 'wishlist', 'ratings', 'cooks'] loop
    execute format('drop policy if exists "%1$s readable" on public.%1$I', t);
    execute format('create policy "%1$s readable" on public.%1$I for select using (true)', t);
    -- Збережене й бажане family.sql переводить на «… write own or family».
    continue when exists (select 1 from pg_policies
                           where schemaname = 'public' and tablename = t
                             and policyname = t || ' write own or family');
    execute format('drop policy if exists "%1$s write own" on public.%1$I', t);
    execute format(
      'create policy "%1$s write own" on public.%1$I for all
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

drop policy if exists "follows readable"  on public.follows;
drop policy if exists "follows write own" on public.follows;
create policy "follows readable" on public.follows for select using (true);
create policy "follows write own" on public.follows
  for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

-- Приватні дані: бачить і змінює лише власник.
do $$
declare t text;
begin
  foreach t in array array['pantry_items', 'shopping_items', 'plan_slots', 'dismissed'] loop
    -- Комору, покупки й план family.sql і shopping.sql роблять сімейними.
    continue when exists (select 1 from pg_policies
                           where schemaname = 'public' and tablename = t
                             and policyname = t || ' own or family');
    execute format('drop policy if exists "%1$s own" on public.%1$I', t);
    execute format(
      'create policy "%1$s own" on public.%1$I for all
         using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

-- Кеш штрихкодів: читають усі, доповнюють авторизовані.
drop policy if exists "barcodes readable" on public.barcode_cache;
drop policy if exists "barcodes insert"   on public.barcode_cache;
create policy "barcodes readable" on public.barcode_cache for select using (true);
create policy "barcodes insert" on public.barcode_cache
  for insert with check (auth.uid() is not null);
-- Уточнити картку може її автор — або будь-хто, якщо автора немає: записи без
-- автора приходять із чеків, де відома лише назва. Сімʼю додає family.sql.
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'barcode_cache' and policyname = 'barcodes update own') then
    create policy "barcodes update own" on public.barcode_cache
      for update
      using (taught_by is null or auth.uid() = taught_by)
      with check (taught_by is null or auth.uid() = taught_by);
  end if;
end $$;

-- Власні продукти: бачать усі (вони стоять у публічних рецептах), додає
-- кожен лише від свого імені.
drop policy if exists "custom ingredients readable"   on public.custom_ingredients;
drop policy if exists "custom ingredients insert own" on public.custom_ingredients;
create policy "custom ingredients readable" on public.custom_ingredients
  for select using (true);
create policy "custom ingredients insert own" on public.custom_ingredients
  for insert with check (auth.uid() = created_by);
-- Прямого UPDATE у клієнтів немає (revoke у розділі каталогу): дописані типи
-- правлять усі через save_custom_ingredient — з версією й історією змін.

-- ── Storage: фото страв ────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', true)
on conflict (id) do update set public = true;

drop policy if exists "recipe images readable"   on storage.objects;
drop policy if exists "recipe images insert own" on storage.objects;
drop policy if exists "recipe images update own" on storage.objects;
drop policy if exists "recipe images delete own" on storage.objects;

create policy "recipe images readable" on storage.objects
  for select using (bucket_id = 'recipe-images');

-- Файли складаємо як recipe-images/<user_id>/<файл>
create policy "recipe images insert own" on storage.objects
  for insert with check (
    bucket_id = 'recipe-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "recipe images delete own" on storage.objects
  for delete using (
    bucket_id = 'recipe-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Заміна фото в наявному рецепті — це UPDATE, а не INSERT: шлях той самий
-- (recipe-images/<user_id>/<recipe_id>.jpg), і клієнт вантажить з upsert.
-- Без цієї політики перше фото зберігалось, а кожне наступне мовчки зникало.
create policy "recipe images update own" on storage.objects
  for update
  using (
    bucket_id = 'recipe-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'recipe-images'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ── В'юхи для читання застосунком ──────────────────────────────────────────
-- security_invoker = RLS перевіряється від імені того, хто читає,
-- а не від імені власника в'юхи. Без цього приватні рецепти протікали б.
alter view public.recipe_stats set (security_invoker = on);

-- Саме drop + create, а не replace: заміна вимагає, щоб колонки лишались на
-- тих самих місцях, а нова колонка в recipes вклинюється всередину переліку.
-- Через це повторний запуск цього файлу на вже наявній базі падав.
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

-- Кількість підписників — показуємо в профілях кухарів.
create or replace view public.profiles_with_counts
with (security_invoker = on) as
select
  p.*,
  (select count(*) from public.follows f where f.followee_id = p.id) as followers,
  (select count(*) from public.recipes r where r.author_id = p.id and r.is_public) as recipe_count
from public.profiles p;

-- ── Останній штрих ─────────────────────────────────────────────────────────
-- PostgREST кешує схему. Без цього перші запити можуть відповідати
-- «Could not find the table in the schema cache».
notify pgrst, 'reload schema';
