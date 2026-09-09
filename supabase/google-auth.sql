-- ============================================================================
--  Ням — оновлення профілю під вхід через Google.
--
--  Потрібне лише тим, хто вже виконував setup.sql ДО додавання Google.
--  У свіжому setup.sql ця версія функції вже є.
--
--  Що робить: при реєстрації через Google бере справжнє імʼя та аватар
--  з даних провайдера, а не тільки шматок пошти.
-- ============================================================================

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

notify pgrst, 'reload schema';
