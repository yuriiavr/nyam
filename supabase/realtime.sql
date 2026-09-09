-- ============================================================================
--  Ням — живі оновлення (Supabase Realtime).
--
--  Виконувати в Supabase → SQL Editor після schema.sql, family.sql
--  і notifications.sql.
--
--  Realtime транслює лише ті таблиці, що додані в публікацію
--  supabase_realtime. Сама публікація створюється разом із проєктом, але
--  порожня — тому без цього скрипта клієнт не отримує нічого, і дані
--  оновлюються лише при перезапуску застосунку.
--
--  RLS діє й на трансляцію: Supabase перевіряє політики для підключеного
--  користувача, тож у канал не потрапить те, чого людині не видно і так.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'notifications',   -- хто підписався, вподобав, приготував
    'recipes',         -- нові та змінені рецепти у стрічці
    'pantry_items',    -- спільна комора сімʼї
    'plan_slots',      -- спільний план харчування
    'family_members'   -- склад сімʼї
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- REPLICA IDENTITY FULL потрібен, щоб у подіях UPDATE і DELETE приходив
-- попередній стан рядка: інакше клієнт не знає, який саме запис прибрати
-- зі свого стану. Для recipes вистачає ключа за замовчуванням.
alter table public.notifications  replica identity full;
alter table public.pantry_items   replica identity full;
alter table public.plan_slots     replica identity full;
alter table public.family_members replica identity full;
