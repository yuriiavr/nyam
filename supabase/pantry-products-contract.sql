-- ============================================================================
--  Ням — контрактний крок комори по товарах: прибрати тимчасове для старих
--  застосунків.
--
--  ЗАСТОСОВУВАТИ ЛИШЕ ПІСЛЯ ДЕПЛОЮ З CLIENT_SCHEMA = 4 І ПІСЛЯ ТОГО, ЯК УСІ
--  ПРИСТРОЇ ПЕРЕЗАВАНТАЖИЛИ ЗАСТОСУНОК. Застосунок до перевірки версії
--  (commit 469a0f4) банера «онови» не покаже взагалі — його телефон треба
--  перезапустити руками. Старий закешований PWA, що переживе цей файл, почне
--  плодити дублікати рядків комори (його upsert без id отримає новий id), а
--  його записи в barcode_cache падатимуть (помилки він ковтає).
--
--  Виконувати в Supabase → SQL Editor після products.sql,
--  pantry-receipt-name.sql і pantry-products.sql. Скрипт ідемпотентний.
--  schema.sql уже містить цю (контрактну) форму комори; на свіжій базі цей
--  файл нічого не змінює. Повторний запуск pantry-receipt-name.sql чи
--  pantry-products.sql після нього тимчасового назад не повертає.
--
--  Що робить:
--    1. ще раз переносить barcode_cache → коди «EAN → тип»: старі клієнти
--       писали туди аж до сьогодні, і ці рядки не мають загубитись;
--    2. pantry_items_before_insert більше не шукає «рядок, який показував
--       старий клієнт»: запис без id — нова пачка;
--    3. id отримує default gen_random_uuid();
--    4. прибирає перенесення касового тексту з label у receipt_name (новий
--       код пише receipt_name сам);
--    5. закриває запис у barcode_cache (читання лишається — нікому не шкодить);
--    6. разово: касове безлактозне молоко без товару стає типом
--       moloko_bezlaktozne (у pantry-receipt-name.sql цього немає — старий
--       застосунок того ключа не знав).
-- ============================================================================

do $$
begin
  if to_regclass('public.product_identifiers') is null then
    raise exception 'Спершу виконай supabase/products.sql' using errcode = '55000';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.pantry_items'::regclass and contype = 'p') is distinct from 'PRIMARY KEY (id)'
     or to_regprocedure('public.pantry_items_sync_product(public.pantry_items)') is null then
    raise exception 'Спершу виконай supabase/pantry-products.sql' using errcode = '55000';
  end if;
end $$;

-- Прапорець «контракт ставить саме цей запуск» (у id ще немає default) — для
-- разової правки даних у кроці 6: повторний запуск не має перебивати тип, який
-- людина вже після контракту свідомо поставила «Молоко». Локальний для транзакції.
select set_config('nyam.pantry_contract_fresh',
  case when exists (select 1 from pg_attrdef d
                      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                     where d.adrelid = 'public.pantry_items'::regclass and a.attname = 'id')
       then '' else 'on' end, true);

-- 1. Штрихкоди, які старі клієнти навчили між products.sql і сьогодні.
-- Код, який хтось свідомо прибрав (delete_identifier — рядок «delete» в
-- історії), назад не повертаємо: інакше перенесення воскресило б помилкову
-- привʼязку для всіх, та ще й без звʼязку з тим видаленням в історії.
insert into public.product_identifiers (kind, scope, raw, type_key, source)
select 'ean', '', b.barcode, b.ingredient_key, 'migration'
  from public.barcode_cache b
 where b.ingredient_key is not null and public.normalize_ean(b.barcode) is not null
   and (exists (select 1 from public.builtin_ingredients x where x.key = b.ingredient_key)
        or exists (select 1 from public.custom_ingredients x where x.key = b.ingredient_key))
   and not exists (select 1 from public.community_changes c
                    where c.table_name = 'product_identifiers' and c.op = 'delete'
                      and c.before ->> 'kind' = 'ean' and c.before ->> 'scope' = ''
                      and c.before ->> 'value' = public.normalize_ean(b.barcode))
on conflict (kind, scope, value) do nothing;

-- 2. Контрактне тіло — дослівно як у schema.sql.
create or replace function public.pantry_items_before_insert()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id is null then new.id := gen_random_uuid(); end if;
  new := public.pantry_items_sync_product(new);
  return new;
end $$;
revoke all on function public.pantry_items_before_insert() from public, anon, authenticated;

-- 3. Тепер default не заважає: тригеру вже не треба бачити NULL.
alter table public.pantry_items alter column id set default gen_random_uuid();

-- 4. Касовий текст у label пишуть лише старі клієнти.
drop trigger if exists pantry_items_split_receipt_label on public.pantry_items;
drop function if exists public.pantry_items_split_receipt_label();
drop function if exists public.looks_like_till_text(text);

-- 5. Довідник штрихкодів заморожено остаточно.
revoke insert, update on public.barcode_cache from anon, authenticated;

-- 6. Безлактозне молоко з чека — свій тип. Тепер безпечно: застосунків, що не
-- знають moloko_bezlaktozne, уже немає. Лише в запуску, що ставить контракт, і
-- лише для рядків без товару: тип рядка з товаром веде товар, а повторний
-- запуск не перебиває вибору людини. Рецептам молоко лишається молоком (батько).
update public.pantry_items p
   set ingredient_key = 'moloko_bezlaktozne'
 where nullif(current_setting('nyam.pantry_contract_fresh', true), '') = 'on'
   and p.ingredient_key = 'moloko' and p.product_id is null
   and p.receipt_name ~* '(безл|блак|б/лак)';
select set_config('nyam.pantry_contract_fresh', '', true);

notify pgrst, 'reload schema';
