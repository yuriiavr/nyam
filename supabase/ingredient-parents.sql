-- ============================================================================
--  Ням — різновиди типів: «Молоко безлактозне» рахується як «Молоко».
--
--  Виконувати в Supabase → SQL Editor після schema.sql, family.sql,
--  custom-ingredients.sql і builtin-ingredients.sql. Скрипт ідемпотентний.
--  Потрібен лише базі, створеній до появи різновидів: schema.sql уже містить
--  те саме.
--
--  Навіщо. Рецепту з молоком підходить і безлактозне, а от безлактозному
--  рецепту звичайне — ні. Вбудовані типи знають своїх батьків із коду
--  (src/data/ingredients.ts, дзеркало — builtin-ingredients.sql), а дописаним
--  людьми батька тримає parent_key. База стежить, щоб дерево лишалось деревом:
--  батько існує, по колу не ходить, і ланцюжок не глибший за шість рівнів.
--
--  Старий застосунок (до різновидів) цих колонок не знає і не пише: його
--  insert без parent_key дає самостійний тип, решту ставить запобіжник.
--  Правок дописаних типів він не робить узагалі — лише створює.
-- ============================================================================

alter table public.custom_ingredients
  add column if not exists parent_key text,
  add column if not exists version    integer not null default 1,
  add column if not exists updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.custom_ingredients drop constraint if exists custom_ingredients_parent_fmt;
alter table public.custom_ingredients add constraint custom_ingredients_parent_fmt
  check (parent_key is null or (parent_key ~ '^[a-z][a-z0-9_]*$' and parent_key <> key));

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

notify pgrst, 'reload schema';
