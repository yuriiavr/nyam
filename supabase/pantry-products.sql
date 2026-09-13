-- ============================================================================
--  Ням — комора по товарах: рядок комори = одна покупка, ключ — id.
--
--  Виконувати в Supabase → SQL Editor після products.sql і
--  pantry-receipt-name.sql (на живій базі: products.sql →
--  pantry-receipt-name.sql → цей файл), ДО деплою коду, що пише комору за id.
--  Скрипт ідемпотентний; запускати цілим файлом (одна транзакція).
--
--  schema.sql тимчасових тригерів не чіпає: контрактну форму комори він ставить
--  лише там, де вона вже є (у id є default — свіжа база або після
--  pantry-products-contract.sql). А цей файл, запущений після контрактного
--  кроку, тимчасове тіло тригера назад не повертає.
--
--  Навіщо. Ключ (user_id, ingredient_key) давав одну пачку молока на людину:
--  дві різні пачки зливались в одну, а правка члена сімʼї в чужому рядку
--  лишала копію під своїм user_id. Тепер кожен рядок має id; тип рядка
--  (ingredient_key) лишається — за ним рецепти шукають «що є», — а товар
--  (product_id) каже, що саме куплено.
--
--  Старий застосунок (закешований PWA) id не знає: його upsert іде без id, а
--  PostgREST після перезавантаження схеми будує `on conflict (id) do update`.
--  Тимчасовий BEFORE INSERT-тригер кладе такий запис на рядок, який старий
--  клієнт показував, — до контрактного кроку.
-- ============================================================================

do $$
begin
  if to_regclass('public.products') is null or to_regclass('public.product_identifiers') is null
     or to_regprocedure('public.normalize_ean(text)') is null then
    raise exception 'Спершу виконай supabase/products.sql' using errcode = '55000';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.pantry_items'::regclass and tgname = 'pantry_items_touch' and not tgisinternal) then
    raise exception 'Спершу виконай supabase/pantry-receipt-name.sql' using errcode = '55000';
  end if;
end $$;

-- БЕЗ default: тригер старих клієнтів має бачити NULL (default підставляється
-- ще до BEFORE-тригерів). Default зʼявиться в контрактному кроці.
alter table public.pantry_items add column if not exists id uuid;
-- Без FK навмисно, як shopping_items.recipe_id: товари створюються лише онлайн,
-- а рядок комори живе й офлайн; тип тримає ingredient_key.
alter table public.pantry_items add column if not exists product_id uuid;

comment on column public.pantry_items.product_id is
  'Товар (products.id) без FK; тип рядка = тип товару (тригери pantry_items_before_*).';

-- Разові правки даних (привʼязка штрихкодів нижче) — лише в запуску, що міняє ключ.
select set_config('nyam.pantry_products_fresh',
  case when (select pg_get_constraintdef(oid) from pg_constraint
              where conrelid = 'public.pantry_items'::regclass and contype = 'p') is distinct from 'PRIMARY KEY (id)'
       then 'on' else '' end, true);

do $$
begin
  if nullif(current_setting('nyam.pantry_products_fresh', true), '') = 'on' then
    -- Копії, які лишили правки старих клієнтів (той самий тип і added_at у
    -- різних людей однієї сімʼї), зливаємо в найсвіжішу. Рядки з різним
    -- added_at — різні пачки, лишаються. Лише поки ключ старий: там пара
    -- (user_id, ingredient_key) однозначно називає рядок, а повторний запуск
    -- сюди не заходить і справжніх рядків не видалить. Копії до I2 мають
    -- однаковий updated_at (час додавання колонки) — вирішує «є кількість»,
    -- далі user_id.
    with ranked as (
      select p.user_id, p.ingredient_key,
             row_number() over (
               partition by coalesce(fm.family_id::text, p.user_id::text), p.ingredient_key, p.added_at
               order by p.updated_at desc, (p.amount is not null) desc, p.user_id) as rn
        from public.pantry_items p
        left join public.family_members fm on fm.user_id = p.user_id)
    delete from public.pantry_items p using ranked r
     where r.rn > 1 and p.user_id = r.user_id and p.ingredient_key = r.ingredient_key;

    -- id без «дотику»: updated_at має лишитись часом останнього запису людини.
    -- (Тригер точно є: перевірка вгорі вимагає pantry-receipt-name.sql.)
    alter table public.pantry_items disable trigger pantry_items_touch;
    update public.pantry_items set id = gen_random_uuid() where id is null;
    alter table public.pantry_items enable trigger pantry_items_touch;

    alter table public.pantry_items alter column id set not null;
    alter table public.pantry_items drop constraint if exists pantry_items_pkey;
    alter table public.pantry_items add constraint pantry_items_pkey primary key (id);
  end if;
end $$;

-- Старий ключ був і індексом «комора людини за типом» — лишаємо його як індекс.
create index if not exists pantry_items_user_type_idx on public.pantry_items (user_id, ingredient_key);
create index if not exists pantry_items_product_idx   on public.pantry_items (product_id) where product_id is not null;

-- Тип рядка = тип товару, завжди. Обʼєднаний товар (I6) — на канонічний.
-- Товару немає (без FK) — лишаємо як прислали. Читає лише відкриті всім
-- колонки products (id, merged_into, type_key), тож invoker.
create or replace function public.pantry_items_sync_product(r public.pantry_items)
returns public.pantry_items language plpgsql stable set search_path = public as $$
declare canon uuid; t text;
begin
  if r.product_id is null then return r; end if;
  select coalesce(p.merged_into, p.id) into canon from public.products p where p.id = r.product_id;
  if canon is null then return r; end if;
  select p.type_key into t from public.products p where p.id = canon;
  if t is null then return r; end if;
  r.product_id := canon; r.ingredient_key := t;
  return r;
end $$;

-- Тимчасове тіло — лише поки контракту немає (у id немає default). Після
-- pantry-products-contract.sql чи на свіжій базі з schema.sql тут уже стоїть
-- контрактне тіло, і повторний запуск цього файлу його не перебиває.
do $do$
begin
  if exists (select 1 from pg_attrdef d
               join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
              where d.adrelid = 'public.pantry_items'::regclass and a.attname = 'id') then
    return;
  end if;
  execute $fn$
create or replace function public.pantry_items_before_insert()
returns trigger language plpgsql set search_path = public as $$
declare target public.pantry_items;
begin
  if new.id is null then
    -- Позначка «цей оператор — запис старого клієнта»: лише такий касовий label
    -- переносить pantry_items_split_receipt_label (див. pantry-receipt-name.sql).
    -- Мітка оператора, а не «on»: наступний запис тієї самої транзакції вже не старий.
    perform set_config('nyam.legacy_pantry_write', statement_timestamp()::text, true);
    -- Старий клієнт пише «людина + тип» без id (і завжди від свого user_id,
    -- навіть правлячи рядок члена сімʼї). Кладемо запис на рядок, який він
    -- показував (dedupePantry): той самий added_at, інакше найраніший рядок
    -- цього типу в сімʼї. Invoker: пошук іде під RLS, чужого не знайде.
    select * into target from public.pantry_items p
     where p.ingredient_key = new.ingredient_key
       and (p.user_id = new.user_id or public.shares_family(p.user_id))
     order by (p.added_at = new.added_at) desc, p.added_at, p.id
     limit 1;
    if found then
      new.id := target.id; new.user_id := target.user_id;    -- далі ON CONFLICT (id) оновить саме його
    else
      new.id := gen_random_uuid();
    end if;
  end if;
  new := public.pantry_items_sync_product(new);
  return new;
end $$
$fn$;
end $do$;

create or replace function public.pantry_items_before_update()
returns trigger language plpgsql set search_path = public as $$
begin
  new.id := old.id;
  new.user_id := old.user_id;          -- власник рядка не змінюється (як keep_shopping_owner)
  new := public.pantry_items_sync_product(new);
  return new;
end $$;

-- BEFORE-тригери однієї події йдуть за абеткою: before_insert/before_update
-- (id, власник, тип) → split_receipt_label → touch.
drop trigger if exists pantry_items_before_insert on public.pantry_items;
create trigger pantry_items_before_insert before insert on public.pantry_items
  for each row execute function public.pantry_items_before_insert();
drop trigger if exists pantry_items_before_update on public.pantry_items;
create trigger pantry_items_before_update before update on public.pantry_items
  for each row execute function public.pantry_items_before_update();

-- Єдиний свідомий запис у чужі рядки: спільнота виправила тип товару — рядки
-- всіх, у кого він є, знову збігаються з рецептами. Відкат правки повертає
-- тип так само. Definer: RLS комори не пустила б у чужі рядки.
create or replace function public.products_type_to_pantry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.pantry_items set ingredient_key = new.type_key
   where product_id = new.id and ingredient_key <> new.type_key;
  return null;
end $$;
drop trigger if exists products_type_to_pantry on public.products;
create trigger products_type_to_pantry after update of type_key on public.products
  for each row when (old.type_key is distinct from new.type_key)
  execute function public.products_type_to_pantry();

-- Рядки, відскановані між I3 і I4, мають штрихкод відомого товару — привʼязуємо.
-- Жодних спільних даних не створюємо; тип підтягне pantry_items_before_update.
-- Лише в запуску, що міняє ключ: пізніше рядок зі штрихкодом без товару —
-- це вибір людини («Лише тип»), і повторний запуск його не перебиває.
update public.pantry_items p set product_id = i.product_id
  from public.product_identifiers i
 where nullif(current_setting('nyam.pantry_products_fresh', true), '') = 'on'
   and p.product_id is null and p.barcode is not null
   and i.kind = 'ean' and i.scope = '' and i.product_id is not null
   and i.value = public.normalize_ean(p.barcode);

select set_config('nyam.pantry_products_fresh', '', true);

-- ── Права на функції ───────────────────────────────────────────────────────
-- Тригерні функції як RPC не викликати, але з /rpc прибираємо однаково.
--
-- pantry_items_sync_product лишається виконуваною для authenticated: її
-- викликають invoker-тригери комори, а EXECUTE вкладеної функції Postgres
-- перевіряє від того, хто пише рядок. Закрити — і кожен запис у комору впаде
-- з 42501. Вона повертає переданий рядок із типом товару, який і так видно всім.
revoke all on function public.pantry_items_before_insert()   from public, anon, authenticated;
revoke all on function public.pantry_items_before_update()   from public, anon, authenticated;
revoke all on function public.products_type_to_pantry()      from public, anon, authenticated;
revoke all on function public.pantry_items_sync_product(public.pantry_items) from public, anon;
grant execute on function public.pantry_items_sync_product(public.pantry_items) to authenticated;

notify pgrst, 'reload schema';
