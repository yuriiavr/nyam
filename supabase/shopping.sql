-- ============================================================================
--  Ням — список покупок.
--
--  Виконувати в Supabase → SQL Editor після schema.sql, family.sql і
--  realtime.sql. Скрипт безпечно запускати повторно.
--
--  Навіщо окрема таблиця, а не похідна від плану: список покупок — це не
--  «чого бракує на тиждень», а те, з чим ідуть у магазин. Туди дописують
--  батарейки, воду коту й «щось до чаю» — речі, до яких застосунку діла
--  немає, але без яких список неправдивий. Похідна цього не вміє за
--  визначенням: її не можна редагувати, бо вона щоразу рахується наново.
-- ============================================================================

create table if not exists public.shopping_items (
  -- Ідентифікатор свій, а не пара «користувач + продукт», як у коморі:
  -- у списку буває два однакові рядки з різних причин, і довільний запис
  -- без ключа продукту теж має чимось називатись.
  id             uuid primary key,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  -- Продукт із каталогу. null — довільний запис, назва лежить у text.
  ingredient_key text,
  -- Назва довільного запису або уточнення до каталожного («сир President»).
  text           text,
  -- Скільки брати: число окремо від одиниці, як і всюди в застосунку.
  amount         numeric(10, 2),
  unit           text,
  -- Куплено. Рядок лишається в списку до кінця походу — викресленим.
  done           boolean not null default false,
  added_at       timestamptz not null default now(),
  -- Звідки взялось: manual | recipe | plan | pantry. Довідково, для підпису.
  source         text,
  -- Рецепт, заради якого це купують. Свідомо БЕЗ зовнішнього ключа: рецепт,
  -- який щойно створили, ще вивантажує фото і в базі зʼявиться на секунду
  -- пізніше. З ключем уся пачка покупок відлітала б із помилкою саме тоді,
  -- коли людина додає склад щойно написаної страви. Підпис «для „Борщу“» і
  -- так збирається з локального стану, а не з цієї колонки.
  recipe_id      uuid,
  -- Рядок без назви не має сенсу: або продукт із каталогу, або текст.
  constraint shopping_items_named check (ingredient_key is not null or text is not null)
);

-- Читаємо завжди «все моє й сімʼї», відсортоване за часом додавання.
create index if not exists shopping_items_user_idx
  on public.shopping_items (user_id, added_at desc);


-- Власник рядка не змінюється ніколи.
--
-- Ключ таблиці — сам рядок, а не пара «людина + продукт», як у коморі. Тому
-- upsert від іншого учасника сімʼї переписав би user_id на себе: досить
-- поставити галочку на чужому хлібі. Далі це тихо коштувало б даних — при
-- виході з сімʼї покупки пішли б за тим, хто останній їх торкався, а не за
-- тим, хто їх додав.
create or replace function public.keep_shopping_owner()
returns trigger language plpgsql as $$
begin
  new.user_id := old.user_id;
  return new;
end;
$$;

drop trigger if exists shopping_items_keep_owner on public.shopping_items;
create trigger shopping_items_keep_owner
  before update on public.shopping_items
  for each row execute function public.keep_shopping_owner();

alter table public.shopping_items enable row level security;

-- Список спільний на читання І на запис: викреслити хліб, який додав хтось
-- інший, — це нормальна дія в магазині, а не втручання в чуже.
--
-- Назва політики виводиться з назви таблиці, як і в family.sql: інакше
-- повторний запуск schema.sql не зміг би її зняти, і таблиця лишилась би
-- єдиною в схемі, де дві політики діють одночасно.
drop policy if exists "shopping own or family" on public.shopping_items;
drop policy if exists "shopping_items own" on public.shopping_items;
drop policy if exists "shopping_items own or family" on public.shopping_items;
create policy "shopping_items own or family" on public.shopping_items
  for all
  using (auth.uid() = user_id or public.shares_family(user_id))
  with check (auth.uid() = user_id or public.shares_family(user_id));

-- Живі оновлення: один пішов у магазин, другий дописує з дому.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shopping_items'
  ) then
    alter publication supabase_realtime add table public.shopping_items;
  end if;
end $$;

-- Щоб у подіях UPDATE і DELETE приходив попередній стан рядка: інакше
-- клієнт не знає, який саме рядок прибрати зі свого стану.
alter table public.shopping_items replica identity full;

-- PostgREST тримає схему в кеші й про нову таблицю сам може не дізнатись.
notify pgrst, 'reload schema';
