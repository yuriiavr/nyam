-- ============================================================================
--  Ням — власні продукти й повна картка товару.
--
--  Виконувати в Supabase → SQL Editor після schema.sql і family.sql.
--  Скрипт безпечно запускати повторно.
--
--  Дві половини однієї проблеми. Каталог на сотню продуктів покриває звичайну
--  кухню, але не кожну: кокосового борошна в ньому немає, і рецепт із ним
--  просто не дописати. А сканер, зустрівши невідомий штрихкод, умів лише
--  спитати «чим це є» — назва «Молоко Галичина 2,5%», вага пачки й КБЖВ з
--  етикетки нікуди не збігались, тож наступного разу все повторювалось.
-- ============================================================================

-- ── Продукти, дописані людьми ──────────────────────────────────────────────
-- Читають усі: власний продукт може стояти в рецепті, який видно всій
-- спільноті, і без цього чужа страва показувала б замість назви сирий ключ.
create table if not exists public.custom_ingredients (
  -- Ключ із префіксом own_, щоб ніколи не збігтися з вбудованим: збіг означав
  -- би, що в чужому рецепті мовчки підмінився продукт.
  key             text primary key check (key ~ '^own_[a-z0-9_]+$'),
  label           text not null check (length(btrim(label)) > 0),
  emoji           text not null default '🍽️',
  -- Категорія з того ж переліку, що й у вбудованих: від неї залежать і
  -- групування в коморі, і відділ у списку покупок.
  cat             text not null default 'other',
  -- Синоніми для пошуку й розпізнавання назв із чека.
  aliases         text[] not null default '{}',
  -- Базове: те, що лежить роками й міряється не вагою, а «є / немає».
  staple          boolean not null default false,
  grams_per_piece numeric(10, 2),
  grams_per_cup   numeric(10, 2),
  default_unit    text not null default 'g',
  -- Харчова цінність на 100 г. Порожня — калорії страви просто не рахуються.
  kcal            numeric(10, 2),
  protein         numeric(10, 2),
  fat             numeric(10, 2),
  carbs           numeric(10, 2),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

alter table public.custom_ingredients enable row level security;

drop policy if exists "custom ingredients readable" on public.custom_ingredients;
drop policy if exists "custom ingredients insert own" on public.custom_ingredients;
drop policy if exists "custom ingredients update own" on public.custom_ingredients;

-- Бачать усі — інакше рецепт із таким продуктом нечитабельний для інших.
create policy "custom ingredients readable" on public.custom_ingredients
  for select using (true);

-- Додає авторизований, і лише від свого імені.
create policy "custom ingredients insert own" on public.custom_ingredients
  for insert with check (auth.uid() = created_by);

-- Правити може автор або його сімʼя: помилку в назві мають виправляти там,
-- де її помітили, а не листуванням.
create policy "custom ingredients update own" on public.custom_ingredients
  for update
  using (auth.uid() = created_by or public.shares_family(created_by))
  with check (auth.uid() = created_by or public.shares_family(created_by));

-- ── Повна картка товару за штрихкодом ──────────────────────────────────────
-- Довідник кодів існував і раніше, але зберігав лише «цей код — це молоко».
-- Тепер туди лягає й те, що знає сама етикетка: вага пачки та КБЖВ. Саме
-- цього бракувало, щоб «Молоко Галичина 900 мл» наступного разу додалось
-- одним дотиком, з вагою й калоріями.
alter table public.barcode_cache
  add column if not exists kcal      numeric(10, 2),
  add column if not exists protein   numeric(10, 2),
  add column if not exists fat       numeric(10, 2),
  add column if not exists carbs     numeric(10, 2),
  add column if not exists amount    numeric(10, 2),
  add column if not exists unit      text,
  -- Хто заповнив картку: щоб її можна було виправити, а не лише перезаписати
  -- кимось стороннім. Довідник кодів спільний на всю спільноту.
  add column if not exists taught_by uuid references public.profiles (id) on delete set null;

drop policy if exists "barcodes update own" on public.barcode_cache;
create policy "barcodes update own" on public.barcode_cache
  for update
  using (auth.uid() = taught_by or public.shares_family(taught_by))
  with check (auth.uid() = taught_by or public.shares_family(taught_by));

-- PostgREST тримає схему в кеші й про нові колонки сам може не дізнатись.
notify pgrst, 'reload schema';
