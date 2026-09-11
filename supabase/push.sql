-- ============================================================================
--  Ням — пуш-сповіщення: підписки пристроїв.
--
--  Виконувати в Supabase → SQL Editor після schema.sql. Скрипт ідемпотентний.
--
--  Один рядок — один пристрій. Ключ — endpoint, який видає сам браузер: він
--  унікальний і саме за ним пуш доставляється. Тому «підписався ще раз з того
--  самого телефона» не плодить дублікатів, а оновлює наявний рядок.
-- ============================================================================

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Ключі шифрування, без яких повідомлення не розшифрувати на пристрої.
  p256dh     text not null,
  auth       text not null,
  -- Для діагностики: з чого підписались і коли востаннє бачили живим.
  agent      text,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push own select" on public.push_subscriptions;
drop policy if exists "push own insert" on public.push_subscriptions;
drop policy if exists "push own update" on public.push_subscriptions;
drop policy if exists "push own delete" on public.push_subscriptions;

-- Кожен бачить і чіпає лише свої підписки. Сервер, який розсилає, ходить із
-- службовим ключем і RLS обходить — інакше він не міг би надіслати нікому.
create policy "push own select" on public.push_subscriptions
  for select using (auth.uid() = user_id);

create policy "push own insert" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

create policy "push own update" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "push own delete" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
