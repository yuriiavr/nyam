-- ============================================================================
--  Ням — ПОВНЕ налаштування бази за один запуск.
--
--  Це supabase/schema.sql + supabase/seed.sql в одному файлі.
--  Встав усе це в Supabase → SQL Editor → Run. Повторний запуск безпечний.
--
--  ЗГЕНЕРОВАНО: node scripts/generate-seed-sql.mjs
-- ============================================================================


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
  user_id        uuid not null references public.profiles (id) on delete cascade,
  ingredient_key text not null,
  label          text,
  qty            text,
  barcode        text,
  -- Скільки коштував грам продукту в останній покупці: з чека відома і сума,
  -- і кількість, а через грам ціна зводиться з кількостями рецептів.
  price_per_gram numeric(10, 6),
  added_at       timestamptz not null default now(),
  primary key (user_id, ingredient_key)
);

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
  updated_at     timestamptz not null default now()
);

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
alter table public.plan_slots   enable row level security;
alter table public.dismissed    enable row level security;
alter table public.barcode_cache enable row level security;

-- Профілі: читає будь-хто, редагує лише власник.
drop policy if exists "profiles readable"  on public.profiles;
drop policy if exists "profiles self write" on public.profiles;
create policy "profiles readable" on public.profiles for select using (true);
create policy "profiles self write" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Рецепти: публічні бачать усі, приватні — лише автор.
drop policy if exists "recipes readable"    on public.recipes;
drop policy if exists "recipes insert own"  on public.recipes;
drop policy if exists "recipes update own"  on public.recipes;
drop policy if exists "recipes delete own"  on public.recipes;
create policy "recipes readable" on public.recipes
  for select using (is_public or auth.uid() = author_id);
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
    execute format('drop policy if exists "%1$s write own" on public.%1$I', t);
    execute format('create policy "%1$s readable" on public.%1$I for select using (true)', t);
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
  foreach t in array array['pantry_items', 'plan_slots', 'dismissed'] loop
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

-- ── Storage: фото страв ────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('recipe-images', 'recipe-images', true)
on conflict (id) do update set public = true;

drop policy if exists "recipe images readable"   on storage.objects;
drop policy if exists "recipe images insert own" on storage.objects;
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

-- ── В'юхи для читання застосунком ──────────────────────────────────────────
-- security_invoker = RLS перевіряється від імені того, хто читає,
-- а не від імені власника в'юхи. Без цього приватні рецепти протікали б.
alter view public.recipe_stats set (security_invoker = on);

create or replace view public.recipes_with_stats
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


-- ============================================================================
--  ЧАСТИНА 2: демо-спільнота
-- ============================================================================

-- Кухарі
insert into public.profiles (id, handle, name, emoji, gradient, bio, city, is_demo) values (
  'fcbdf3b6-d383-3ca9-98f0-a971ee5cd02b', 'olya.cooks', 'Оля Кравець', '👩‍🍳',
  array['#ff6b35', '#ffb020']::text[], 'Домашня класика без понтів. Готую те, що їла в бабусі.', 'Львів', true
) on conflict (id) do update set
  handle = excluded.handle, name = excluded.name, emoji = excluded.emoji,
  gradient = excluded.gradient, bio = excluded.bio, city = excluded.city;

insert into public.profiles (id, handle, name, emoji, gradient, bio, city, is_demo) values (
  'ad3e7e3c-25a5-311d-b13f-5b2c8be5f1fd', 'taras.wok', 'Тарас Не', '🔥',
  array['#f43f6a', '#ff6b35']::text[], 'Азія на домашній плиті. Люблю гостре сильніше, ніж треба.', 'Київ', true
) on conflict (id) do update set
  handle = excluded.handle, name = excluded.name, emoji = excluded.emoji,
  gradient = excluded.gradient, bio = excluded.bio, city = excluded.city;

insert into public.profiles (id, handle, name, emoji, gradient, bio, city, is_demo) values (
  '09b58cfe-2c31-3c1d-b666-7425cb401a43', 'marta.green', 'Марта Зелінська', '🥑',
  array['#34d399', '#38bdf8']::text[], 'Рослинне, свіже, за 20 хвилин. Мінімум посуду.', 'Одеса', true
) on conflict (id) do update set
  handle = excluded.handle, name = excluded.name, emoji = excluded.emoji,
  gradient = excluded.gradient, bio = excluded.bio, city = excluded.city;

insert into public.profiles (id, handle, name, emoji, gradient, bio, city, is_demo) values (
  '97c4f8db-70cd-3756-a650-29ea7436daba', 'dima.grill', 'Діма Гриль', '🥩',
  array['#a78bfa', '#f43f6a']::text[], 'Мʼясо, вогонь, соуси. Готую багато й ситно.', 'Харків', true
) on conflict (id) do update set
  handle = excluded.handle, name = excluded.name, emoji = excluded.emoji,
  gradient = excluded.gradient, bio = excluded.bio, city = excluded.city;

insert into public.profiles (id, handle, name, emoji, gradient, bio, city, is_demo) values (
  '3d3949fb-b993-3cc3-8a2f-41239f53cce1', 'sweet.solo', 'Соломія Пʼятниця', '🍰',
  array['#ffb020', '#f43f6a']::text[], 'Десерти, які виходять з першого разу. Обіцяю.', 'Івано-Франківськ', true
) on conflict (id) do update set
  handle = excluded.handle, name = excluded.name, emoji = excluded.emoji,
  gradient = excluded.gradient, bio = excluded.bio, city = excluded.city;

insert into public.profiles (id, handle, name, emoji, gradient, bio, city, is_demo) values (
  '6631531c-30a7-3980-b809-11cbebacf326', 'hostel.chef', 'Влад з гуртожитку', '🎓',
  array['#38bdf8', '#a78bfa']::text[], 'Смачно за 60 гривень і одну сковорідку. Перевірено сесією.', 'Дніпро', true
) on conflict (id) do update set
  handle = excluded.handle, name = excluded.name, emoji = excluded.emoji,
  gradient = excluded.gradient, bio = excluded.bio, city = excluded.city;

-- Рецепти
insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '277eca74-6bf6-3776-ad8b-f118465525fd', 'fcbdf3b6-d383-3ca9-98f0-a971ee5cd02b', 'Червоний борщ', 'Той самий, густий, з насиченим кольором. Секрет — буряк тушкуємо окремо з оцтом, щоб не втратив колір.',
  '🍲', array['#c026d3', '#f43f6a']::text[], 'Українська',
  array['lunch', 'dinner']::text[], array['comfort', 'hearty', 'cozy']::text[], array['класика', 'на кілька днів', 'суп']::text[],
  90, 2, 6, 320, 1,
  '[{"key":"buryak","qty":"2 шт","optional":false},{"key":"kartoplya","qty":"4 шт","optional":false},{"key":"kapusta","qty":"300 г","optional":false},{"key":"morkva","qty":"1 шт","optional":false},{"key":"tsybulya","qty":"1 шт","optional":false},{"key":"tomatna_pasta","qty":"2 ст. л.","optional":false},{"key":"svynyna","qty":"400 г","optional":true},{"key":"chasnyk","qty":"3 зубчики","optional":false},{"key":"otset","qty":"1 ст. л.","optional":false},{"key":"smetana","qty":"для подачі","optional":true},{"key":"zelen","qty":"пучок","optional":false}]'::jsonb, '[{"text":"Звари бульйон на мʼясі, зніми піну. Якщо без мʼяса — просто закип''яти 3 л води.","timerSec":3600,"tip":null},{"text":"Буряк натри, туши на олії з томатною пастою та оцтом 15 хв — саме оцет тримає колір.","timerSec":900,"tip":"Не додавай буряк у киплячий борщ без оцту — стане рудим."},{"text":"Окремо підсмаж цибулю з морквою до мʼякості.","timerSec":480,"tip":null},{"text":"У бульйон закинь картоплю кубиком, вари 10 хв, потім капусту — ще 5 хв.","timerSec":900,"tip":null},{"text":"Додай буряк і засмажку, посоли, вари 5 хв і вимкни.","timerSec":300,"tip":null},{"text":"Вкинь товчений часник і зелень, накрий кришкою і дай настоятись 20 хв.","timerSec":1200,"tip":null}]'::jsonb, '2026-08-27T12:00:00.000Z',
  3420, 1890, 1204, 4210, 880
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  'bffbcd59-f62c-3d36-a34d-780aca4ac82a', 'fcbdf3b6-d383-3ca9-98f0-a971ee5cd02b', 'Деруни зі сметаною', 'Хрусткі по краях, мʼякі всередині. Найкращий спосіб зʼїсти кілограм картоплі.',
  '🥔', array['#f59e0b', '#ff6b35']::text[], 'Українська',
  array['breakfast', 'lunch']::text[], array['comfort', 'cheap', 'hearty']::text[], array['смаженя', 'бюджетно']::text[],
  35, 1, 3, 410, 1,
  '[{"key":"kartoplya","qty":"6 шт","optional":false},{"key":"tsybulya","qty":"1 шт","optional":false},{"key":"yajtsya","qty":"1 шт","optional":false},{"key":"boroshno","qty":"2 ст. л.","optional":false},{"key":"oliya","qty":"для смаження","optional":false},{"key":"smetana","qty":"для подачі","optional":false},{"key":"sil","qty":"до смаку","optional":false}]'::jsonb, '[{"text":"Картоплю і цибулю натри на дрібній тертці. Цибуля не дасть картоплі потемніти.","timerSec":null,"tip":null},{"text":"Відціди зайву рідину — деруни будуть хрусткими, а не вареними.","timerSec":null,"tip":null},{"text":"Вмішай яйце, борошно, сіль і перець. Тісто має бути як густа сметана.","timerSec":null,"tip":null},{"text":"Смаж на добре розігрітій олії по 3–4 хв з кожного боку до темно-золотого.","timerSec":240,"tip":null},{"text":"Виклади на серветку, подавай гарячими зі сметаною.","timerSec":null,"tip":null}]'::jsonb, '2026-09-03T12:00:00.000Z',
  2870, 1510, 990, 3620, 760
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  'aa188e78-3366-31ba-a268-65b7de2d53f9', 'fcbdf3b6-d383-3ca9-98f0-a971ee5cd02b', 'Сирники як у дитинстві', 'Мінімум борошна — максимум сиру. Пишні, не розповзаються.',
  '🥞', array['#fbbf24', '#fb7185']::text[], 'Українська',
  array['breakfast', 'dessert']::text[], array['comfort', 'sweet', 'fast']::text[], array['сніданок', 'солодке', '20 хвилин']::text[],
  25, 1, 2, 340, 1,
  '[{"key":"tvorog","qty":"400 г","optional":false},{"key":"yajtsya","qty":"1 шт","optional":false},{"key":"tsukor","qty":"2 ст. л.","optional":false},{"key":"boroshno","qty":"3 ст. л.","optional":false},{"key":"vanil","qty":"щіпка","optional":false},{"key":"smetana","qty":"для подачі","optional":true},{"key":"yagody","qty":"жменя","optional":true}]'::jsonb, '[{"text":"Сир протри через сито або пробий блендером — від цього залежить ніжність.","timerSec":null,"tip":null},{"text":"Вмішай яйце, цукор, ваніль і борошно. Тісто буде липким — так і треба.","timerSec":null,"tip":null},{"text":"Мокрими руками сформуй шайби 2 см завтовшки, обваляй у борошні.","timerSec":null,"tip":null},{"text":"Смаж на середньому вогні під кришкою по 3 хв з боку.","timerSec":180,"tip":null},{"text":"Подавай зі сметаною та ягодами.","timerSec":null,"tip":null}]'::jsonb, '2026-09-06T12:00:00.000Z',
  4110, 2600, 1720, 5480, 1120
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  'dfb8e362-1432-31af-8fd0-fc9ecbdf9256', 'fcbdf3b6-d383-3ca9-98f0-a971ee5cd02b', 'Вареники з картоплею і шкварками', 'Довго, але медитативно. Ліпи більше — половину в морозилку.',
  '🥟', array['#fcd34d', '#f97316']::text[], 'Українська',
  array['lunch', 'dinner']::text[], array['comfort', 'hearty', 'cheap']::text[], array['на вихідні', 'заморозка']::text[],
  80, 3, 4, 480, 1,
  '[{"key":"boroshno","qty":"500 г","optional":false},{"key":"voda","qty":"250 мл","optional":false},{"key":"yajtsya","qty":"1 шт","optional":false},{"key":"kartoplya","qty":"800 г","optional":false},{"key":"tsybulya","qty":"2 шт","optional":false},{"key":"bekon","qty":"150 г","optional":true},{"key":"maslo","qty":"50 г","optional":false},{"key":"smetana","qty":"для подачі","optional":false}]'::jsonb, '[{"text":"Замісь тісто: борошно, тепла вода, яйце, сіль. Вимішуй 8 хв до гладкості.","timerSec":480,"tip":null},{"text":"Накрий тісто і залиш відпочити 30 хв — стане еластичним.","timerSec":1800,"tip":null},{"text":"Звари картоплю, розімни з підсмаженою цибулею і маслом.","timerSec":null,"tip":null},{"text":"Розкачай тісто, виріж кружечки, поклади начинку, защипни краї.","timerSec":null,"tip":null},{"text":"Вари в підсоленій воді 3–4 хв після спливання.","timerSec":240,"tip":null},{"text":"Подавай зі шкварками, смаженою цибулею і сметаною.","timerSec":null,"tip":null}]'::jsonb, '2026-08-18T12:00:00.000Z',
  2210, 1980, 640, 2890, 590
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '9ecdaf2b-cf68-3746-9da9-ac5f3cf6d95a', 'ad3e7e3c-25a5-311d-b13f-5b2c8be5f1fd', 'Справжня карбонара', 'Без вершків. Соус робиться з яєць, сиру і води від пасти — і це працює.',
  '🍝', array['#fbbf24', '#facc15']::text[], 'Італійська',
  array['lunch', 'dinner']::text[], array['fast', 'comfort', 'fancy']::text[], array['20 хвилин', 'паста', 'класика']::text[],
  20, 2, 2, 620, 2,
  '[{"key":"makarony","qty":"200 г","optional":false},{"key":"bekon","qty":"120 г","optional":false},{"key":"yajtsya","qty":"2 жовтки + 1 яйце","optional":false},{"key":"parmezan","qty":"60 г","optional":false},{"key":"perets_ch","qty":"багато","optional":false}]'::jsonb, '[{"text":"Постав воду. Соли менше, ніж зазвичай — бекон і пармезан вже солоні.","timerSec":null,"tip":null},{"text":"Наріж бекон смужками, витопи на сухій сковороді до хрусткого.","timerSec":420,"tip":null},{"text":"Збий яйця з тертим пармезаном і великою кількістю перцю в однорідну пасту.","timerSec":null,"tip":null},{"text":"Звари пасту на 1 хв менше, ніж на пачці. Збережи склянку води!","timerSec":480,"tip":null},{"text":"Зніми сковороду з вогню, вкинь пасту, влий яєчну суміш і швидко мішай, підливаючи воду.","timerSec":null,"tip":"Головне — на вимкненому вогні, інакше буде яєчня."},{"text":"Подавай миттєво, зверху ще пармезан.","timerSec":null,"tip":null}]'::jsonb, '2026-09-05T12:00:00.000Z',
  5240, 3380, 2010, 6900, 1400
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  'aa0111a5-dc02-3b23-8737-49105376e843', 'ad3e7e3c-25a5-311d-b13f-5b2c8be5f1fd', 'Том ям з креветками', 'Кисло-гостро-солоний удар по рецепторах. Найшвидший спосіб зігрітися.',
  '🍜', array['#f43f6a', '#ff6b35']::text[], 'Тайська',
  array['lunch', 'dinner']::text[], array['spicy', 'cozy', 'fancy']::text[], array['гостре', 'суп', 'азія']::text[],
  30, 2, 3, 380, 3,
  '[{"key":"krevetky","qty":"300 г","optional":false},{"key":"tom_yam_pasta","qty":"2 ст. л.","optional":false},{"key":"kokos_moloko","qty":"200 мл","optional":false},{"key":"gryby","qty":"150 г","optional":false},{"key":"pomidor","qty":"2 шт","optional":false},{"key":"lime","qty":"1 шт","optional":false},{"key":"chili","qty":"1 шт","optional":false},{"key":"imbyr","qty":"шматочок","optional":false},{"key":"bulion","qty":"800 мл","optional":false},{"key":"zelen","qty":"кінза","optional":false}]'::jsonb, '[{"text":"Закип''яти бульйон з імбиром і чилі, вари 5 хв щоб віддали аромат.","timerSec":300,"tip":null},{"text":"Додай пасту том ям, розмішай до розчинення.","timerSec":null,"tip":null},{"text":"Вкинь гриби і томати часточками, вари 5 хв.","timerSec":300,"tip":null},{"text":"Влий кокосове молоко, доведи майже до кипіння — не кип''яти.","timerSec":null,"tip":null},{"text":"Додай креветки і вимкни через 2 хв, щойно стануть рожеві.","timerSec":120,"tip":null},{"text":"Вичави лайм уже у вимкнений суп, посип кінзою.","timerSec":null,"tip":null}]'::jsonb, '2026-09-01T12:00:00.000Z',
  3980, 2740, 860, 4990, 1010
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '8af488a2-7632-36ce-bf00-f8cab4853fb7', 'ad3e7e3c-25a5-311d-b13f-5b2c8be5f1fd', 'Курка теріякі з рисом', 'Липкий солодко-солоний соус робиться з чотирьох інгредієнтів за 5 хвилин.',
  '🍗', array['#b45309', '#f59e0b']::text[], 'Японська',
  array['lunch', 'dinner']::text[], array['fast', 'hearty', 'comfort']::text[], array['30 хвилин', 'азія', 'мітпреп']::text[],
  30, 1, 2, 560, 2,
  '[{"key":"kurka","qty":"400 г","optional":false},{"key":"soyevyi","qty":"4 ст. л.","optional":false},{"key":"med","qty":"2 ст. л.","optional":false},{"key":"chasnyk","qty":"2 зубчики","optional":false},{"key":"imbyr","qty":"1 ч. л.","optional":false},{"key":"rys","qty":"150 г","optional":false},{"key":"kunzhut","qty":"для подачі","optional":false},{"key":"zelen","qty":"зелена цибуля","optional":false}]'::jsonb, '[{"text":"Постав рис варитись за інструкцією на пачці.","timerSec":900,"tip":null},{"text":"Наріж курку смужками, обсмаж на сильному вогні до золотого.","timerSec":420,"tip":null},{"text":"Змішай соєвий соус, мед, часник і імбир.","timerSec":null,"tip":null},{"text":"Влий соус до курки, туши 4–5 хв поки не загусне і не почне блищати.","timerSec":300,"tip":null},{"text":"Подавай на рисі, посипавши кунжутом і зеленою цибулею.","timerSec":null,"tip":null}]'::jsonb, '2026-09-07T12:00:00.000Z',
  4620, 3120, 2380, 5700, 1180
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '7155b595-f4fa-3f59-9a30-e5ee8d690d38', 'ad3e7e3c-25a5-311d-b13f-5b2c8be5f1fd', 'Удон з овочами у воку', '15 хвилин від холодильника до тарілки. Овочі можна брати будь-які.',
  '🥢', array['#ea580c', '#facc15']::text[], 'Азійська',
  array['lunch', 'dinner']::text[], array['fast', 'cheap', 'healthy']::text[], array['15 хвилин', 'вок', 'вегетаріанське']::text[],
  15, 1, 2, 430, 1,
  '[{"key":"lokshyna","qty":"200 г","optional":false},{"key":"perets","qty":"1 шт","optional":false},{"key":"morkva","qty":"1 шт","optional":false},{"key":"brokoli","qty":"150 г","optional":false},{"key":"soyevyi","qty":"3 ст. л.","optional":false},{"key":"chasnyk","qty":"2 зубчики","optional":false},{"key":"oliya","qty":"2 ст. л.","optional":false},{"key":"kunzhut","qty":"1 ст. л.","optional":false}]'::jsonb, '[{"text":"Залий локшину окропом за інструкцією, відціди.","timerSec":null,"tip":null},{"text":"Наріж усі овочі соломкою — однаково тонко, щоб приготувались разом.","timerSec":null,"tip":null},{"text":"Розігрій сковороду до максимуму, смаж овочі 4 хв, постійно мішаючи.","timerSec":240,"tip":null},{"text":"Додай часник, потім локшину і соєвий соус, прогрій 2 хв.","timerSec":120,"tip":null},{"text":"Посип кунжутом і подавай одразу.","timerSec":null,"tip":null}]'::jsonb, '2026-08-30T12:00:00.000Z',
  2140, 1620, 1180, 2650, 560
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '754e5628-a42a-34e5-a418-4fe4eda7f48a', '09b58cfe-2c31-3c1d-b666-7425cb401a43', 'Шакшука', 'Яйця, запечені в пряному томатному соусі. Сніданок, який рятує неділю.',
  '🍳', array['#dc2626', '#f97316']::text[], 'Близькосхідна',
  array['breakfast', 'lunch']::text[], array['comfort', 'healthy', 'fast']::text[], array['сніданок', 'одна сковорідка', 'вегетаріанське']::text[],
  25, 1, 2, 300, 1,
  '[{"key":"yajtsya","qty":"4 шт","optional":false},{"key":"pomidory_konserv","qty":"400 г","optional":false},{"key":"perets","qty":"1 шт","optional":false},{"key":"tsybulya","qty":"1 шт","optional":false},{"key":"chasnyk","qty":"3 зубчики","optional":false},{"key":"paprika","qty":"1 ч. л.","optional":false},{"key":"kmyn","qty":"1 ч. л.","optional":false},{"key":"feta","qty":"50 г","optional":true},{"key":"khlib","qty":"для подачі","optional":false}]'::jsonb, '[{"text":"Обсмаж цибулю і перець на оливковій олії до мʼякості, 6 хв.","timerSec":360,"tip":null},{"text":"Додай часник, паприку і зіру, прогрій 30 секунд до аромату.","timerSec":30,"tip":null},{"text":"Влий томати, туши на середньому вогні 10 хв поки соус не загусне.","timerSec":600,"tip":null},{"text":"Зроби ложкою заглиблення і вбий у кожне яйце.","timerSec":null,"tip":null},{"text":"Накрий кришкою і готуй 5–7 хв — білок схопився, жовток рідкий.","timerSec":400,"tip":null},{"text":"Розкриши фету, посип зеленню, вимочуй хлібом.","timerSec":null,"tip":null}]'::jsonb, '2026-09-04T12:00:00.000Z',
  3760, 2410, 1490, 4700, 950
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '020ef7ca-6de6-3d8f-8d1c-0b0207d068b1', '09b58cfe-2c31-3c1d-b666-7425cb401a43', 'Крем-суп з гарбуза', 'Оксамитовий, зігріваючий, з хрусткими насінинками зверху.',
  '🎃', array['#f97316', '#fbbf24']::text[], 'Європейська',
  array['lunch', 'dinner']::text[], array['cozy', 'healthy', 'comfort']::text[], array['осінь', 'суп', 'вегетаріанське']::text[],
  40, 1, 4, 210, 1,
  '[{"key":"garbuz","qty":"800 г","optional":false},{"key":"morkva","qty":"1 шт","optional":false},{"key":"tsybulya","qty":"1 шт","optional":false},{"key":"chasnyk","qty":"2 зубчики","optional":false},{"key":"vershky","qty":"100 мл","optional":true},{"key":"bulion","qty":"600 мл","optional":false},{"key":"imbyr","qty":"1 ч. л.","optional":true},{"key":"gorikhy","qty":"для подачі","optional":true}]'::jsonb, '[{"text":"Наріж гарбуз, моркву і цибулю великими шматками, скинь на деко з оливковою олією.","timerSec":null,"tip":null},{"text":"Запікай при 200°C 25 хв — карамелізація дає весь смак.","timerSec":1500,"tip":null},{"text":"Перекинь у каструлю, залий гарячим бульйоном, пробий блендером до гладкості.","timerSec":null,"tip":null},{"text":"Влий вершки, прогрій, посоли, додай імбир.","timerSec":null,"tip":null},{"text":"Подавай з підсмаженими горіхами і краплею оливкової олії.","timerSec":null,"tip":null}]'::jsonb, '2026-08-24T12:00:00.000Z',
  2530, 1880, 810, 3180, 640
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '94fa5330-9b4d-3e10-b0ee-11dfaea1e701', '09b58cfe-2c31-3c1d-b666-7425cb401a43', 'Хумус за 10 хвилин', 'Секрет кремовості — крижана вода і терпіння в блендері.',
  '🫓', array['#d97706', '#fbbf24']::text[], 'Близькосхідна',
  array['snack', 'lunch']::text[], array['healthy', 'fast', 'cheap']::text[], array['веган', 'перекус', '10 хвилин']::text[],
  10, 1, 4, 180, 1,
  '[{"key":"nut","qty":"400 г консервованого","optional":false},{"key":"tahini","qty":"3 ст. л.","optional":false},{"key":"lymon","qty":"1 шт","optional":false},{"key":"chasnyk","qty":"1 зубчик","optional":false},{"key":"olyvkova","qty":"3 ст. л.","optional":false},{"key":"kmyn","qty":"1 ч. л.","optional":false},{"key":"tortylya","qty":"для подачі","optional":false}]'::jsonb, '[{"text":"Злий рідину з нуту, але залиш 3 ложки — вона знадобиться.","timerSec":null,"tip":null},{"text":"Пробий нут з тахіні, соком лимона, часником і зірою.","timerSec":null,"tip":null},{"text":"Підливай крижану воду по ложці, збиваючи 3 хв — маса посвітлішає і стане пухкою.","timerSec":180,"tip":null},{"text":"Виклади в тарілку, зроби ложкою борозну, залий оливковою олією і посип паприкою.","timerSec":null,"tip":null}]'::jsonb, '2026-08-21T12:00:00.000Z',
  1890, 1440, 720, 2300, 470
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '24fddd5c-aa8f-3940-90a6-17ad2e693077', '09b58cfe-2c31-3c1d-b666-7425cb401a43', 'Грецький салат', 'Жодного салатного листя — тільки овочі великим кубиком і фета плитою.',
  '🥗', array['#22c55e', '#38bdf8']::text[], 'Грецька',
  array['lunch', 'snack']::text[], array['fresh', 'healthy', 'fast']::text[], array['без готування', 'літо', '10 хвилин']::text[],
  10, 1, 2, 260, 2,
  '[{"key":"pomidor","qty":"3 шт","optional":false},{"key":"ogirok","qty":"1 шт","optional":false},{"key":"perets","qty":"1 шт","optional":false},{"key":"tsybulya","qty":"1/2 червоної","optional":false},{"key":"feta","qty":"150 г","optional":false},{"key":"olivky","qty":"жменя","optional":false},{"key":"olyvkova","qty":"3 ст. л.","optional":false},{"key":"oregano","qty":"1 ч. л.","optional":false}]'::jsonb, '[{"text":"Наріж усі овочі великими шматками — це принципово, дрібний кубик пустить сік.","timerSec":null,"tip":null},{"text":"Цибулю наріж тонкими півкільцями і потримай хвилину в холодній воді, щоб не гірчила.","timerSec":null,"tip":null},{"text":"Змішай овочі з оливками, полий олією, посоли, посип орегано.","timerSec":null,"tip":null},{"text":"Зверху поклади цілу плиту фети, ще раз олія і перець.","timerSec":null,"tip":null}]'::jsonb, '2026-08-13T12:00:00.000Z',
  2980, 1720, 1650, 3600, 740
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '4cd82796-1931-3e04-b133-9474417949a6', '09b58cfe-2c31-3c1d-b666-7425cb401a43', 'Смузі-боул із ягодами', 'Сніданок, який виглядає як десерт. Головне — заморожені ягоди, а не лід.',
  '🥤', array['#8b5cf6', '#ec4899']::text[], 'Здорове',
  array['breakfast', 'snack', 'drink']::text[], array['fresh', 'healthy', 'fast', 'sweet']::text[], array['5 хвилин', 'без плити', 'веган']::text[],
  5, 1, 1, 290, 2,
  '[{"key":"yagody","qty":"200 г заморожених","optional":false},{"key":"banan","qty":"1 шт","optional":false},{"key":"jogurt","qty":"150 г","optional":false},{"key":"med","qty":"1 ст. л.","optional":true},{"key":"gorikhy","qty":"жменя","optional":false},{"key":"vivsyanka","qty":"2 ст. л.","optional":true}]'::jsonb, '[{"text":"Пробий заморожені ягоди з бананом і йогуртом. Рідини мінімум — має бути густо як морозиво.","timerSec":null,"tip":null},{"text":"Переклади в миску, розрівняй.","timerSec":null,"tip":null},{"text":"Виклади зверху горіхи, вівсянку, свіжі ягоди — і зʼїж одразу, поки холодне.","timerSec":null,"tip":null}]'::jsonb, '2026-09-02T12:00:00.000Z',
  1620, 980, 640, 1950, 410
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  'cfec9d04-363c-3d02-af10-23ddb12dd1f5', '97c4f8db-70cd-3756-a650-29ea7436daba', 'Домашній бургер', 'Котлета з двох інгредієнтів. Не мни фарш — і буде соковито.',
  '🍔', array['#b91c1c', '#f59e0b']::text[], 'Американська',
  array['lunch', 'dinner']::text[], array['hearty', 'comfort', 'fancy']::text[], array['мʼясо', 'вечір пʼятниці']::text[],
  35, 2, 2, 780, 2,
  '[{"key":"farsh","qty":"400 г","optional":false},{"key":"bulochka","qty":"2 шт","optional":false},{"key":"syr","qty":"2 скибки","optional":false},{"key":"pomidor","qty":"1 шт","optional":false},{"key":"salat","qty":"кілька листків","optional":false},{"key":"tsybulya","qty":"1 шт","optional":false},{"key":"maionez","qty":"2 ст. л.","optional":false},{"key":"girchytsya","qty":"1 ч. л.","optional":false},{"key":"ogirok","qty":"мариновані","optional":true}]'::jsonb, '[{"text":"Фарш посоли тільки перед смаженням і не вимішуй — сформуй пласкі котлети, ширші за булку.","timerSec":null,"tip":null},{"text":"Зроби пальцем ямку в центрі котлети, щоб не здулась.","timerSec":null,"tip":null},{"text":"Смаж на дуже гарячій сухій сковороді по 3 хв з боку, не тисни лопаткою.","timerSec":180,"tip":null},{"text":"Поклади сир на котлету, накрий на 30 секунд щоб розтанув.","timerSec":30,"tip":null},{"text":"Підсуши булочки зрізом на сковороді — вони не розмокнуть.","timerSec":null,"tip":null},{"text":"Змішай майонез з гірчицею, збери бургер: соус, салат, котлета, овочі, соус.","timerSec":null,"tip":null}]'::jsonb, '2026-08-31T12:00:00.000Z',
  4380, 2260, 1310, 5390, 1090
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '52e01350-f48a-338a-ad7e-bd0bee07ffc1', '97c4f8db-70cd-3756-a650-29ea7436daba', 'Плов у казані', 'Рис розсипчастий, мʼясо мʼяке. Не мішай після того, як залив воду.',
  '🍚', array['#c2410c', '#f59e0b']::text[], 'Узбецька',
  array['lunch', 'dinner']::text[], array['hearty', 'comfort']::text[], array['на компанію', 'на кілька днів']::text[],
  75, 2, 6, 610, 2,
  '[{"key":"rys","qty":"600 г","optional":false},{"key":"yalovychyna","qty":"600 г","optional":false},{"key":"morkva","qty":"500 г","optional":false},{"key":"tsybulya","qty":"3 шт","optional":false},{"key":"chasnyk","qty":"2 головки","optional":false},{"key":"kmyn","qty":"1 ст. л.","optional":false},{"key":"oliya","qty":"150 мл","optional":false}]'::jsonb, '[{"text":"Промий рис до прозорої води і залий теплою водою на 30 хв.","timerSec":1800,"tip":null},{"text":"Розжар олію в казані, обсмаж мʼясо великими шматками до кірочки.","timerSec":600,"tip":null},{"text":"Додай цибулю півкільцями, потім моркву довгою соломкою — не тертою!","timerSec":600,"tip":null},{"text":"Залий окропом на 2 см вище, вкинь цілі головки часнику, туши 30 хв.","timerSec":1800,"tip":null},{"text":"Виклади рис рівним шаром, долий окропу на 1,5 см, посип зірою. Не мішай!","timerSec":null,"tip":null},{"text":"Готуй на сильному вогні поки вода не піде, потім накрий і томи 20 хв на мінімумі.","timerSec":1200,"tip":null},{"text":"Вимкни, дай постояти 10 хв і перемішай знизу вгору.","timerSec":600,"tip":null}]'::jsonb, '2026-08-09T12:00:00.000Z',
  3120, 2540, 690, 4000, 800
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  'f5d262ca-4468-3682-b01a-4f70628b7a0a', '97c4f8db-70cd-3756-a650-29ea7436daba', 'Лосось з лимоном у духовці', '12 хвилин у духовці — і риба соковита. Головне не пересушити.',
  '🐟', array['#fb7185', '#fdba74']::text[], 'Європейська',
  array['dinner']::text[], array['healthy', 'fancy', 'fast']::text[], array['корисне', '20 хвилин', 'духовка']::text[],
  20, 1, 2, 400, 3,
  '[{"key":"losos","qty":"2 стейки","optional":false},{"key":"lymon","qty":"1 шт","optional":false},{"key":"chasnyk","qty":"2 зубчики","optional":false},{"key":"maslo","qty":"30 г","optional":false},{"key":"zelen","qty":"кріп","optional":false},{"key":"olyvkova","qty":"1 ст. л.","optional":false},{"key":"brokoli","qty":"200 г","optional":true}]'::jsonb, '[{"text":"Розігрій духовку до 200°C. Рибу обсуши серветкою — інакше не буде кірочки.","timerSec":null,"tip":null},{"text":"Змішай мʼяке масло з часником, кропом і цедрою лимона.","timerSec":null,"tip":null},{"text":"Змасти рибу сумішшю, зверху поклади кружальця лимона.","timerSec":null,"tip":null},{"text":"Запікай 12 хв. Готовність — коли рибу легко розділити виделкою на пелюстки.","timerSec":720,"tip":null},{"text":"Дай постояти 3 хв перед подачею.","timerSec":180,"tip":null}]'::jsonb, '2026-08-28T12:00:00.000Z',
  2740, 1930, 880, 3450, 700
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  'e9228b42-0a0b-3855-8bd2-775449eb34cd', '97c4f8db-70cd-3756-a650-29ea7436daba', 'Курячий суп з локшиною', 'Лікує все. Прозорий бульйон виходить, якщо не давати кипіти ключем.',
  '🍲', array['#eab308', '#fde047']::text[], 'Домашня',
  array['lunch', 'dinner']::text[], array['cozy', 'comfort', 'cheap']::text[], array['коли хворієш', 'суп']::text[],
  60, 1, 5, 240, 1,
  '[{"key":"kurka","qty":"500 г","optional":false},{"key":"lokshyna","qty":"150 г","optional":false},{"key":"morkva","qty":"1 шт","optional":false},{"key":"tsybulya","qty":"1 шт","optional":false},{"key":"kartoplya","qty":"3 шт","optional":false},{"key":"zelen","qty":"пучок","optional":false},{"key":"sil","qty":"до смаку","optional":false}]'::jsonb, '[{"text":"Залий курку холодною водою, доведи до кипіння і злий першу воду.","timerSec":null,"tip":null},{"text":"Залий свіжою водою, вари на найменшому вогні 30 хв, знімаючи піну.","timerSec":1800,"tip":null},{"text":"Додай картоплю кубиком і моркву кружальцями, вари 12 хв.","timerSec":720,"tip":null},{"text":"Вкинь локшину, вари ще 5 хв.","timerSec":300,"tip":null},{"text":"Розбери мʼясо, поверни в суп, посип зеленню.","timerSec":null,"tip":null}]'::jsonb, '2026-08-20T12:00:00.000Z',
  2050, 1360, 1020, 2600, 530
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '70362162-c8de-3d8d-a7f7-b61d3b4d50d5', '3d3949fb-b993-3cc3-8a2f-41239f53cce1', 'Тірамісу без випікання', 'Найкращий десерт, який неможливо зіпсувати. Готується ввечері, їсться зранку.',
  '🍰', array['#78350f', '#d97706']::text[], 'Італійська',
  array['dessert']::text[], array['sweet', 'fancy', 'comfort']::text[], array['без духовки', 'десерт', 'на свято']::text[],
  30, 2, 6, 450, 2,
  '[{"key":"savoyardi","qty":"24 шт","optional":false},{"key":"yajtsya","qty":"4 шт","optional":false},{"key":"tsukor","qty":"100 г","optional":false},{"key":"kava","qty":"300 мл міцної","optional":false},{"key":"kakao","qty":"для присипки","optional":false},{"key":"vershky","qty":"500 г маскарпоне","optional":false}]'::jsonb, '[{"text":"Звари каву і повністю охолоди — тепла кава розмочить печиво в кашу.","timerSec":null,"tip":null},{"text":"Збий жовтки з цукром до світлої пишної маси, 5 хв.","timerSec":300,"tip":null},{"text":"Вмішай маскарпоне лопаткою, не міксером — інакше крем розшарується.","timerSec":null,"tip":null},{"text":"Окремо збий білки до стійких піків і обережно з''єднай з кремом.","timerSec":null,"tip":null},{"text":"Занурюй савоярді в каву на 1 секунду з кожного боку, викладай шарами з кремом.","timerSec":null,"tip":null},{"text":"Постав у холодильник мінімум на 4 години, краще на ніч.","timerSec":3600,"tip":null},{"text":"Присип какао через сито безпосередньо перед подачею.","timerSec":null,"tip":null}]'::jsonb, '2026-08-25T12:00:00.000Z',
  6210, 4820, 1540, 7900, 1590
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  'c61d405c-72c3-3ffe-818e-eb412c4c4672', '3d3949fb-b993-3cc3-8a2f-41239f53cce1', 'Млинці з бананом і шоколадом', 'Тонкі, еластичні, не рвуться. Тісто має відпочити — це не пропускати.',
  '🥞', array['#f59e0b', '#fb923c']::text[], 'Домашня',
  array['breakfast', 'dessert']::text[], array['sweet', 'comfort', 'cheap']::text[], array['сніданок', 'солодке', 'діти']::text[],
  40, 2, 4, 380, 1,
  '[{"key":"boroshno","qty":"200 г","optional":false},{"key":"moloko","qty":"500 мл","optional":false},{"key":"yajtsya","qty":"2 шт","optional":false},{"key":"tsukor","qty":"2 ст. л.","optional":false},{"key":"maslo","qty":"30 г","optional":false},{"key":"banan","qty":"2 шт","optional":false},{"key":"shokolad","qty":"100 г","optional":false}]'::jsonb, '[{"text":"Збий яйця з цукром, влий половину молока, всип борошно і розмішай до гладкості.","timerSec":null,"tip":null},{"text":"Долий решту молока і розтоплене масло. Тісто як рідкі вершки.","timerSec":null,"tip":null},{"text":"Дай тісту постояти 20 хв — клейковина розслабиться, млинці не рватимуться.","timerSec":1200,"tip":null},{"text":"Печи на добре розігрітій сковороді по 1 хв з боку.","timerSec":60,"tip":null},{"text":"Начиняй бананом і розтопленим шоколадом, згортай трикутником.","timerSec":null,"tip":null}]'::jsonb, '2026-08-16T12:00:00.000Z',
  3340, 2010, 1420, 4180, 850
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  'd44ab0ed-2faa-37e4-ac8c-571043629efd', '6631531c-30a7-3980-b809-11cbebacf326', 'Омлет з сиром за 7 хвилин', 'Мінімальний набір, максимальний результат. Головне — слабкий вогонь.',
  '🍳', array['#facc15', '#fb923c']::text[], 'Домашня',
  array['breakfast']::text[], array['fast', 'cheap', 'comfort']::text[], array['5 хвилин', 'бюджетно', 'сніданок']::text[],
  7, 1, 1, 320, 1,
  '[{"key":"yajtsya","qty":"3 шт","optional":false},{"key":"moloko","qty":"2 ст. л.","optional":false},{"key":"syr","qty":"40 г","optional":false},{"key":"maslo","qty":"10 г","optional":false},{"key":"zelen","qty":"щіпка","optional":true}]'::jsonb, '[{"text":"Збий яйця з молоком і сіллю виделкою до однорідності — але без фанатизму.","timerSec":null,"tip":null},{"text":"Розтопи масло на слабкому вогні, влий яйця.","timerSec":null,"tip":null},{"text":"Коли краї схопились, лопаткою збирай їх до центру, нахиляючи сковороду.","timerSec":120,"tip":null},{"text":"Посип сиром, склади навпіл і вимкни — залишкового тепла вистачить.","timerSec":60,"tip":null}]'::jsonb, '2026-09-07T12:00:00.000Z',
  1980, 1120, 1860, 2420, 500
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '576a8560-0171-3e85-9122-5b6821dad731', '6631531c-30a7-3980-b809-11cbebacf326', 'Гречка з грибами і цибулею', 'Класика виживання, яка насправді дуже смачна. Гриби смаж окремо.',
  '🍄', array['#78716c', '#a8a29e']::text[], 'Домашня',
  array['lunch', 'dinner']::text[], array['cheap', 'hearty', 'comfort']::text[], array['бюджетно', 'вегетаріанське', '30 хвилин']::text[],
  30, 1, 3, 340, 1,
  '[{"key":"grechka","qty":"250 г","optional":false},{"key":"gryby","qty":"300 г","optional":false},{"key":"tsybulya","qty":"2 шт","optional":false},{"key":"maslo","qty":"30 г","optional":false},{"key":"oliya","qty":"2 ст. л.","optional":false},{"key":"smetana","qty":"2 ст. л.","optional":true}]'::jsonb, '[{"text":"Гречку промий і залий водою 1:2, вари під кришкою 15 хв не мішаючи.","timerSec":900,"tip":null},{"text":"Гриби смаж на сухій сковороді, поки не випарується вся вода.","timerSec":420,"tip":null},{"text":"Тепер додай олію і цибулю, смаж до золотого.","timerSec":360,"tip":null},{"text":"Змішай гречку з грибами, додай масло, накрий на 5 хв.","timerSec":300,"tip":null}]'::jsonb, '2026-08-23T12:00:00.000Z',
  1520, 1030, 1140, 1830, 390
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  'ecfd7ae1-0f03-3e72-8a5d-ae7286e01070', '6631531c-30a7-3980-b809-11cbebacf326', 'Піца Маргарита вдома', 'Тісто на 3 інгредієнти. Духовку грій на максимум — це головний секрет.',
  '🍕', array['#dc2626', '#facc15']::text[], 'Італійська',
  array['dinner', 'snack']::text[], array['comfort', 'cheap', 'hearty']::text[], array['на компанію', 'тісто', 'духовка']::text[],
  50, 2, 3, 520, 1,
  '[{"key":"boroshno","qty":"300 г","optional":false},{"key":"drizhdzhi","qty":"7 г","optional":false},{"key":"voda","qty":"180 мл теплої","optional":false},{"key":"pomidory_konserv","qty":"200 г","optional":false},{"key":"motsarela","qty":"200 г","optional":false},{"key":"bazylik","qty":"жменя","optional":false},{"key":"olyvkova","qty":"2 ст. л.","optional":false}]'::jsonb, '[{"text":"Змішай борошно, дріжджі, сіль і теплу воду. Вимішуй 7 хв до гладкого тіста.","timerSec":420,"tip":null},{"text":"Накрий і залиш підходити 30–40 хв, поки не збільшиться вдвічі.","timerSec":2100,"tip":null},{"text":"Розігрій духовку до максимуму (250°C) разом з деком — щонайменше 20 хв.","timerSec":1200,"tip":null},{"text":"Розтягни тісто руками, не качалкою — краї мають лишитись пухкими.","timerSec":null,"tip":null},{"text":"Змасти томатами, розклади моцарелу шматками, збризни олією.","timerSec":null,"tip":null},{"text":"Печи 8–10 хв до підпалин на бортику, базилік клади вже після духовки.","timerSec":540,"tip":null}]'::jsonb, '2026-08-29T12:00:00.000Z',
  3610, 2380, 1090, 4400, 900
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;

insert into public.recipes (
  id, author_id, title, description, emoji, gradient, cuisine,
  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,
  ingredients, steps, created_at,
  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count
) values (
  '169aa3e7-cdd0-3472-8d32-08cb85e6bcb2', '6631531c-30a7-3980-b809-11cbebacf326', 'Овочеве рагу з холодильника', 'Рецепт-каркас: працює з будь-якими овочами, які треба доїсти.',
  '🥘', array['#16a34a', '#eab308']::text[], 'Домашня',
  array['lunch', 'dinner']::text[], array['cheap', 'healthy', 'comfort']::text[], array['антивідходи', 'вегетаріанське', 'одна каструля']::text[],
  40, 1, 4, 230, 1,
  '[{"key":"kartoplya","qty":"4 шт","optional":false},{"key":"kabachok","qty":"1 шт","optional":false},{"key":"perets","qty":"1 шт","optional":false},{"key":"morkva","qty":"1 шт","optional":false},{"key":"tsybulya","qty":"1 шт","optional":false},{"key":"pomidory_konserv","qty":"200 г","optional":false},{"key":"chasnyk","qty":"2 зубчики","optional":false},{"key":"zelen","qty":"пучок","optional":false},{"key":"baklazhan","qty":"1 шт","optional":true}]'::jsonb, '[{"text":"Обсмаж цибулю з морквою 5 хв.","timerSec":300,"tip":null},{"text":"Додавай овочі за часом готування: спершу картопля, через 5 хв решта.","timerSec":null,"tip":"Тверде — раніше, мʼяке — пізніше. Це весь принцип."},{"text":"Влий томати і трохи води, туши під кришкою 20 хв.","timerSec":1200,"tip":null},{"text":"Наприкінці додай часник і зелень, посоли.","timerSec":null,"tip":null}]'::jsonb, '2026-08-26T12:00:00.000Z',
  1340, 1180, 760, 1600, 340
) on conflict (id) do update set
  title = excluded.title, description = excluded.description, emoji = excluded.emoji,
  gradient = excluded.gradient, cuisine = excluded.cuisine,
  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,
  time_min = excluded.time_min, difficulty = excluded.difficulty,
  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,
  ingredients = excluded.ingredients, steps = excluded.steps,
  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,
  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,
  seed_rating_count = excluded.seed_rating_count;


-- Скидаємо кеш схеми PostgREST, інакше перші запити дадуть 404.
notify pgrst, 'reload schema';
