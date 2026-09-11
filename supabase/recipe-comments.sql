-- ============================================================================
--  Ням — коментарі до рецептів: враження тих, хто готував.
--
--  Виконувати в Supabase → SQL Editor після schema.sql і notifications.sql.
--  Скрипт ідемпотентний.
-- ============================================================================

create table if not exists public.recipe_comments (
  id         uuid primary key default uuid_generate_v4(),
  recipe_id  uuid not null references public.recipes (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  -- Довжину обмежуємо тут, а не лише у формі: правило про вміст таблиці має
  -- жити в таблиці, інакше його обійде будь-хто з ключем.
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists recipe_comments_recipe_idx
  on public.recipe_comments (recipe_id, created_at desc);

alter table public.recipe_comments enable row level security;

drop policy if exists "comments readable"   on public.recipe_comments;
drop policy if exists "comments insert own" on public.recipe_comments;
drop policy if exists "comments delete own" on public.recipe_comments;

-- Коментарі видно рівно там, де видно сам рецепт: під приватним рецептом
-- вони лишаються приватними разом із ним.
create policy "comments readable" on public.recipe_comments
  for select using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and (r.is_public or r.author_id = auth.uid())
    )
  );

create policy "comments insert own" on public.recipe_comments
  for insert with check (auth.uid() = author_id);

-- Прибрати може або той, хто написав, або автор рецепта у себе під стравою.
create policy "comments delete own" on public.recipe_comments
  for delete using (
    auth.uid() = author_id
    or exists (
      select 1 from public.recipes r where r.id = recipe_id and r.author_id = auth.uid()
    )
  );

-- ── Сповіщення авторові рецепта ─────────────────────────────────────────────
-- Створює тригер, а не клієнт: інакше будь-хто міг би надіслати підроблене
-- сповіщення від чужого імені. Так само зроблено для лайків і збережень.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('follow', 'like', 'save', 'cook', 'rating', 'family_join', 'comment'));

create or replace function public.notify_recipe_comment() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  select author_id into owner from public.recipes where id = new.recipe_id;
  -- Сам собі під рецептом не сповіщаємо.
  if owner is not null and owner <> new.author_id then
    insert into public.notifications (user_id, actor_id, type, recipe_id)
    values (owner, new.author_id, 'comment', new.recipe_id);
  end if;
  return new;
end;
$$;

drop trigger if exists recipe_comment_notify on public.recipe_comments;
create trigger recipe_comment_notify
  after insert on public.recipe_comments
  for each row execute function public.notify_recipe_comment();

notify pgrst, 'reload schema';
