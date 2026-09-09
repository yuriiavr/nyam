-- ============================================================================
--  Ням — сповіщення: хто підписався, вподобав, зберіг, приготував.
--
--  Виконувати в Supabase → SQL Editor після schema.sql і family.sql.
--  Скрипт ідемпотентний.
--
--  Записи створюють тригери на follows / likes / saves / cooks / ratings,
--  а не клієнт: інакше будь-хто міг би надіслати підроблене сповіщення.
-- ============================================================================

create table if not exists public.notifications (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete cascade,
  type       text not null check (type in ('follow', 'like', 'save', 'cook', 'rating', 'family_join')),
  recipe_id  uuid references public.recipes (id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- Дедуплікація: відписка-підписка або зняти-поставити лайк не мають
-- засмічувати стрічку. «Приготував» свідомо не дедуплікуємо — готувати
-- ту саму страву двічі це нормальна подія.
create unique index if not exists notifications_dedupe_recipe_idx
  on public.notifications (user_id, actor_id, type, recipe_id)
  where type in ('like', 'save', 'rating');

create unique index if not exists notifications_dedupe_follow_idx
  on public.notifications (user_id, actor_id, type)
  where type = 'follow';

-- ── Запис сповіщень ────────────────────────────────────────────────────────
-- SECURITY DEFINER: тригер спрацьовує від імені того, хто зробив дію,
-- а рядок треба покласти в чужу стрічку — під RLS це було б заборонено.
create or replace function public.push_notification(
  recipient uuid,
  actor     uuid,
  kind      text,
  recipe    uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Власні дії себе не сповіщають.
  if recipient is null or actor is null or recipient = actor then
    return;
  end if;

  insert into public.notifications (user_id, actor_id, type, recipe_id)
  values (recipient, actor, kind, recipe)
  on conflict do nothing;
end;
$$;

create or replace function public.notify_on_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.push_notification(new.followee_id, new.follower_id, 'follow');
  return new;
end;
$$;

create or replace function public.notify_on_recipe_action()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  author uuid;
  kind   text := tg_argv[0];
begin
  select author_id into author from public.recipes where id = new.recipe_id;
  perform public.push_notification(author, new.user_id, kind, new.recipe_id);
  return new;
end;
$$;

-- Нового учасника сімʼї бачать усі, хто вже в ній.
create or replace function public.notify_on_family_join()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mate uuid;
begin
  for mate in
    select user_id from public.family_members
    where family_id = new.family_id and user_id <> new.user_id
  loop
    perform public.push_notification(mate, new.user_id, 'family_join');
  end loop;
  return new;
end;
$$;

drop trigger if exists follows_notify on public.follows;
create trigger follows_notify
  after insert on public.follows
  for each row execute function public.notify_on_follow();

drop trigger if exists likes_notify on public.likes;
create trigger likes_notify
  after insert on public.likes
  for each row execute function public.notify_on_recipe_action('like');

drop trigger if exists saves_notify on public.saves;
create trigger saves_notify
  after insert on public.saves
  for each row execute function public.notify_on_recipe_action('save');

drop trigger if exists cooks_notify on public.cooks;
create trigger cooks_notify
  after insert on public.cooks
  for each row execute function public.notify_on_recipe_action('cook');

drop trigger if exists ratings_notify on public.ratings;
create trigger ratings_notify
  after insert on public.ratings
  for each row execute function public.notify_on_recipe_action('rating');

drop trigger if exists family_join_notify on public.family_members;
create trigger family_join_notify
  after insert on public.family_members
  for each row execute function public.notify_on_family_join();

-- ── Позначити прочитаним ───────────────────────────────────────────────────
create or replace function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null;
$$;

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Вставки лише через тригери вище, тому політики на insert немає.
alter table public.notifications enable row level security;

drop policy if exists "notifications own read"   on public.notifications;
drop policy if exists "notifications own update" on public.notifications;
drop policy if exists "notifications own delete" on public.notifications;

create policy "notifications own read" on public.notifications
  for select using (auth.uid() = user_id);

create policy "notifications own update" on public.notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notifications own delete" on public.notifications
  for delete using (auth.uid() = user_id);

-- ── Права на функції ───────────────────────────────────────────────────────
-- push_notification критична: без revoke будь-хто міг би через PostgREST
-- підкинути підроблене сповіщення в чужу стрічку. Її викликають лише тригери.
revoke all on function public.push_notification(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.notify_on_follow()        from public, anon, authenticated;
revoke all on function public.notify_on_recipe_action() from public, anon, authenticated;
revoke all on function public.notify_on_family_join()   from public, anon, authenticated;

revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;

notify pgrst, 'reload schema';
