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
  user_id        uuid not null references public.profiles (id) on delete cascade,
  ingredient_key text not null,
  label          text,
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
  primary key (user_id, ingredient_key)
);

create index if not exists pantry_items_expires_idx
  on public.pantry_items (user_id, expires_at)
  where expires_at is not null;

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
notify pgrst, 'reload schema';
