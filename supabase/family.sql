-- ============================================================================
--  Ням — сімʼї: спільна комора, план, рецепти, збережене та бажане.
--
--  Виконувати в Supabase → SQL Editor після schema.sql.
--  Скрипт ідемпотентний: його безпечно запускати повторно.
--
--  Модель: сімʼя — це набір користувачів. Дані лишаються привʼязаними до
--  того, хто їх додав (user_id), а «спільність» дає RLS: член сімʼї бачить
--  і редагує рядки решти членів. Так вихід із сімʼї не потребує міграції
--  даних — кожен просто лишається зі своїм.
-- ============================================================================

-- ── Таблиці ────────────────────────────────────────────────────────────────
create table if not exists public.families (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null default 'Моя сімʼя'
                check (char_length(name) between 1 and 60),
  invite_code text not null unique,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- user_id як PRIMARY KEY — саме це обмежує користувача однією сімʼєю.
create table if not exists public.family_members (
  user_id   uuid primary key references public.profiles (id) on delete cascade,
  family_id uuid not null references public.families (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now()
);

create index if not exists family_members_family_idx
  on public.family_members (family_id);

-- ── Хелпери ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER навмисно: ці функції читають family_members в обхід RLS.
-- Інакше політика на family_members, яка сама питає family_members, дала б
-- нескінченну рекурсію.

create or replace function public.my_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from public.family_members where user_id = auth.uid();
$$;

-- Чи належить `other` до тієї ж сімʼї, що й поточний користувач.
-- Для користувача без сімʼї підзапит дає null → порівняння завжди false.
create or replace function public.shares_family(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members m
    where m.user_id = other
      and m.family_id = (
        select family_id from public.family_members where user_id = auth.uid()
      )
  );
$$;

-- Код без символів, які плутають при диктуванні: без I, O, 0, 1.
create or replace function public.gen_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code     text;
begin
  loop
    code := '';
    for i in 1 .. 6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.families where invite_code = code);
  end loop;
  return code;
end;
$$;

-- ── Дії над сімʼєю ─────────────────────────────────────────────────────────
-- Усе через RPC: так у families/family_members не потрібні політики на запис,
-- а перевірки («вже в сімʼї», «код не існує») дають зрозумілі помилки.

create or replace function public.create_family(family_name text default null)
returns public.families
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  fam public.families;
begin
  if uid is null then
    raise exception 'Треба увійти в акаунт' using errcode = '28000';
  end if;
  if exists (select 1 from public.family_members where user_id = uid) then
    raise exception 'Ти вже в сімʼї' using errcode = 'P0001';
  end if;

  insert into public.families (name, invite_code, created_by)
  values (
    coalesce(nullif(btrim(family_name), ''), 'Моя сімʼя'),
    public.gen_invite_code(),
    uid
  )
  returning * into fam;

  insert into public.family_members (user_id, family_id, role)
  values (uid, fam.id, 'owner');

  return fam;
end;
$$;

create or replace function public.join_family(code text)
returns public.families
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  fam public.families;
begin
  if uid is null then
    raise exception 'Треба увійти в акаунт' using errcode = '28000';
  end if;
  if exists (select 1 from public.family_members where user_id = uid) then
    raise exception 'Ти вже в сімʼї — спершу вийди з поточної' using errcode = 'P0001';
  end if;

  select * into fam
  from public.families
  where invite_code = upper(btrim(code));

  if fam.id is null then
    raise exception 'Такого коду не існує' using errcode = 'P0002';
  end if;

  insert into public.family_members (user_id, family_id, role)
  values (uid, fam.id, 'member');

  return fam;
end;
$$;

-- Вихід із сімʼї. Останній учасник забирає сімʼю зі собою; якщо йде власник,
-- а люди лишаються — власником стає найдавніший із них.
create or replace function public.leave_family()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  fam_id   uuid;
  my_role  text;
  heir     uuid;
begin
  select family_id, role into fam_id, my_role
  from public.family_members where user_id = uid;

  if fam_id is null then
    return;
  end if;

  delete from public.family_members where user_id = uid;

  if not exists (select 1 from public.family_members where family_id = fam_id) then
    delete from public.families where id = fam_id;
    return;
  end if;

  if my_role = 'owner' then
    select user_id into heir
    from public.family_members
    where family_id = fam_id
    order by joined_at
    limit 1;

    update public.family_members set role = 'owner' where user_id = heir;
  end if;
end;
$$;

create or replace function public.rename_family(family_name text)
returns public.families
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  fam public.families;
begin
  if not exists (
    select 1 from public.family_members
    where user_id = uid and role = 'owner'
  ) then
    raise exception 'Перейменувати може лише власник сімʼї' using errcode = '42501';
  end if;

  update public.families
  set name = coalesce(nullif(btrim(family_name), ''), name)
  where id = public.my_family_id()
  returning * into fam;

  return fam;
end;
$$;

create or replace function public.remove_family_member(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if target = uid then
    raise exception 'Щоб вийти самому, скористайся виходом із сімʼї' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.family_members
    where user_id = uid and role = 'owner'
  ) then
    raise exception 'Виключати учасників може лише власник' using errcode = '42501';
  end if;

  delete from public.family_members
  where user_id = target and family_id = public.my_family_id();
end;
$$;

-- Нова сімʼя не потрібна автоматично: користувач без сімʼї працює як раніше.

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.families       enable row level security;
alter table public.family_members enable row level security;

-- Читати можна лише свою сімʼю. Запису немає взагалі — тільки через RPC вище.
drop policy if exists "families readable" on public.families;
create policy "families readable" on public.families
  for select using (id = public.my_family_id());

drop policy if exists "family members readable" on public.family_members;
create policy "family members readable" on public.family_members
  for select using (family_id = public.my_family_id());

-- ── Розширення наявних політик на сімʼю ────────────────────────────────────
-- Комора і план: спільні на читання ТА на запис — прибрати молоко, яке додав
-- хтось інший, це нормальна дія у спільному холодильнику.
do $$
declare t text;
begin
  foreach t in array array['pantry_items', 'plan_slots'] loop
    execute format('drop policy if exists "%1$s own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s own or family" on public.%1$I', t);
    execute format(
      'create policy "%1$s own or family" on public.%1$I for all
         using (auth.uid() = user_id or public.shares_family(user_id))
         with check (auth.uid() = user_id or public.shares_family(user_id))', t);
  end loop;
end $$;

-- Збережене й бажане: політика на читання лишається публічною (з неї рахуються
-- агрегати), а запис розширюємо на сімʼю.
do $$
declare t text;
begin
  foreach t in array array['saves', 'wishlist'] loop
    execute format('drop policy if exists "%1$s write own" on public.%1$I', t);
    execute format('drop policy if exists "%1$s write own or family" on public.%1$I', t);
    execute format(
      'create policy "%1$s write own or family" on public.%1$I for all
         using (auth.uid() = user_id or public.shares_family(user_id))
         with check (auth.uid() = user_id or public.shares_family(user_id))', t);
  end loop;
end $$;

-- Рецепти: сімʼя бачить навіть приватні рецепти одне одного.
-- Редагувати й видаляти лишається правом автора — спільна видимість не те саме,
-- що спільне право переписати чужий рецепт.
drop policy if exists "recipes readable" on public.recipes;
create policy "recipes readable" on public.recipes
  for select using (
    is_public
    or auth.uid() = author_id
    or public.shares_family(author_id)
  );

-- ── Права на функції ───────────────────────────────────────────────────────
-- За замовчуванням Postgres дає EXECUTE ролі PUBLIC, а PostgREST відкриває
-- кожну функцію в public як /rest/v1/rpc/<name>. Тому внутрішні функції треба
-- закривати явно, інакше їх можна викликати ззовні.

revoke all on function public.gen_invite_code() from public, anon, authenticated;

revoke all on function public.create_family(text)        from public, anon;
revoke all on function public.join_family(text)          from public, anon;
revoke all on function public.leave_family()             from public, anon;
revoke all on function public.rename_family(text)        from public, anon;
revoke all on function public.remove_family_member(uuid) from public, anon;

grant execute on function public.create_family(text)        to authenticated;
grant execute on function public.join_family(text)          to authenticated;
grant execute on function public.leave_family()             to authenticated;
grant execute on function public.rename_family(text)        to authenticated;
grant execute on function public.remove_family_member(uuid) to authenticated;

-- my_family_id і shares_family лишаються доступними навмисно: їх викликають
-- вирази RLS-політик, які виконуються з правами того, хто робить запит.
-- Заберемо EXECUTE — і впадуть усі читання recipes/pantry_items/plan_slots.
grant execute on function public.my_family_id()      to anon, authenticated;
grant execute on function public.shares_family(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
