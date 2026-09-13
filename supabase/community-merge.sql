-- ============================================================================
--  Ням — обʼєднання дублікатів: карток товарів і дописаних типів.
--
--  Виконувати в Supabase → SQL Editor після products.sql і
--  pantry-products.sql (обʼєднання переносить рядки комори за product_id).
--  Скрипт ідемпотентний. Код із «Обʼєднати» деплоїти ПІСЛЯ.
--  Свіжа база з schema.sql це вже має — там повторний запуск нічого не змінює.
--  Для старого застосунку (без обʼєднань) безпечний: прямий insert дописаного
--  типу проходить як і раніше, merged_into він не шле й не читає.
--
--  Навіщо. Двоє людей у різних магазинах створюють «Молоко Галичина 2,5%» і
--  «Галичина молоко 2.5» — картки різні, штрихкоди й назви з чеків
--  розбігаються між ними, а рядки комори показують то одну, то іншу. Те саме
--  з типами: «own_kefir_bezlaktoznyi» і «own_kefir_bez_laktozy». Видаляти
--  нічого не можна (рецепти й комори посилаються), тож переможена картка
--  (тип) стає псевдонімом переможця:
--    - коди й рядки комори переходять до переможця, merged_from памʼятає,
--      звідки кожен код прийшов — unmerge_product забирає назад рівно ці;
--    - переможець дозаповнюється: упаковка, КБЖВ цілим блоком, фото;
--    - ланцюжки сплющуються: хто вже був обʼєднаний у переможеного, тепер
--      указує прямо на переможця;
--    - усе пишеться в історію (op = merge / unmerge);
--    - обидва обʼєднання розʼєднуються: unmerge_product і
--      unmerge_custom_ingredient (для типів — разом із рядками комори й
--      списку, які памʼятає закрита custom_ingredient_merges).
--
--  merged_into міняють ЛИШЕ ці функції: запобіжники пропускають зміну тільки
--  під nyam.merge = on, яку ставлять вони самі на час транзакції.
-- ============================================================================

do $$
begin
  if to_regclass('public.products') is null or to_regprocedure('public.community_budget(int)') is null then
    raise exception 'Спершу виконай supabase/products.sql' using errcode = '55000';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'pantry_items' and column_name = 'product_id') then
    raise exception 'Спершу виконай supabase/pantry-products.sql' using errcode = '55000';
  end if;
end $$;

-- ── Дописані типи: псевдонім ───────────────────────────────────────────────
-- Без FK: переможцем буває й вбудований тип (його немає в custom_ingredients).
alter table public.custom_ingredients add column if not exists merged_into text;
alter table public.custom_ingredients drop constraint if exists custom_ingredients_merged_fmt;
alter table public.custom_ingredients add constraint custom_ingredients_merged_fmt
  check (merged_into is null or (merged_into ~ '^[a-z][a-z0-9_]*$' and merged_into <> key));

-- Канонічний ключ типу: переможений дописаний тип → його переможець (один
-- крок — обʼєднання сплющує ланцюжки). Для вбудованих і звичайних — сам ключ.
create or replace function public.canonical_type_key(p_key text)
returns text language sql stable set search_path = public as $$
  select coalesce((select c.merged_into from public.custom_ingredients c where c.key = p_key), p_key)
$$;

-- Окремий тригер, а не правка custom_ingredients_guard: запобіжник дерева
-- лишається дослівно таким, як у ingredient-parents.sql і schema.sql, і
-- повторний запуск тих файлів цих правил не зітре. BEFORE-тригери однієї
-- таблиці йдуть за абеткою: «…_canonical» спрацьовує раніше за «…_guard»,
-- тож обхід дерева вже бачить канонічного батька.
create or replace function public.custom_ingredients_canonical()
returns trigger language plpgsql set search_path = public as $$
begin
  -- «on delete set null» від видалення профілю — не правка (див. custom_ingredients_guard).
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1
     and to_jsonb(new) - 'created_by' - 'updated_by' = to_jsonb(old) - 'created_by' - 'updated_by' then
    return new;
  end if;
  if nullif(current_setting('nyam.merge', true), '') is distinct from 'on' then
    -- Прямий insert (так пишуть і старі клієнти) псевдонімом не робить.
    new.merged_into := case when tg_op = 'UPDATE' then old.merged_into end;
  end if;
  -- Батьком не буває переможений тип — лише його переможець.
  if new.parent_key is not null then
    new.parent_key := public.canonical_type_key(new.parent_key);
  end if;
  return new;
end $$;
drop trigger if exists custom_ingredients_canonical on public.custom_ingredients;
create trigger custom_ingredients_canonical before insert or update on public.custom_ingredients
  for each row execute function public.custom_ingredients_canonical();

-- Картки й коди з переможеним типом одразу пишуться на переможця: інакше
-- новий товар «own_kefir_bez_laktozy» знову розколов би пошук за типом.
-- «products_canonical_type» < «products_guard» за абеткою — спершу ключ, потім перевірка.
create or replace function public.catalog_canonical_type()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.type_key is not null then
    new.type_key := public.canonical_type_key(new.type_key);
  end if;
  return new;
end $$;
drop trigger if exists products_canonical_type on public.products;
create trigger products_canonical_type before insert or update of type_key on public.products
  for each row execute function public.catalog_canonical_type();
drop trigger if exists product_identifiers_canonical_type on public.product_identifiers;
create trigger product_identifiers_canonical_type before insert or update of type_key on public.product_identifiers
  for each row execute function public.catalog_canonical_type();

-- ── Сумісність типів ───────────────────────────────────────────────────────
-- Один тип — предок-або-сам другого (по вбудованих і дописаних разом).
-- «Молоко» й «Молоко безлактозне» — так; «Молоко» й «Кефір» — ні.
create or replace function public.types_compatible(p_a text, p_b text)
returns boolean language sql stable set search_path = public as $$
  with recursive tree as (
    select key, parent_key from public.builtin_ingredients
    union all
    select key, public.canonical_type_key(parent_key) from public.custom_ingredients where merged_into is null
  ), up (start, key, depth) as (
    select s, s, 0 from unnest(array[public.canonical_type_key(p_a), public.canonical_type_key(p_b)]) s
    union all
    select up.start, t.parent_key, up.depth + 1
      from up join tree t on t.key = up.key
     where t.parent_key is not null and up.depth < 12
  )
  select exists (select 1 from up where up.start = public.canonical_type_key(p_a) and up.key = public.canonical_type_key(p_b))
      or exists (select 1 from up where up.start = public.canonical_type_key(p_b) and up.key = public.canonical_type_key(p_a))
$$;

-- ── Обʼєднати картки ───────────────────────────────────────────────────────
create or replace function public.merge_products(p_loser uuid, p_winner uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.products;
  w public.products;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_loser is null or p_winner is null or p_loser = p_winner then
    raise exception 'Обери дві різні картки' using errcode = '22023';
  end if;
  perform public.community_budget(10);

  -- Блокуємо в сталому порядку: два зустрічні обʼєднання не заклинять одне одного.
  perform 1 from public.products p where p.id in (p_loser, p_winner) order by p.id for update;
  select * into l from public.products p where p.id = p_loser and p.merged_into is null and not p.archived;
  if not found then raise exception 'Цієї картки вже немає або її обʼєднано' using errcode = 'P0002'; end if;
  select * into w from public.products p where p.id = p_winner and p.merged_into is null and not p.archived;
  if not found then raise exception 'Цієї картки вже немає або її обʼєднано' using errcode = 'P0002'; end if;
  if not public.types_compatible(l.type_key, w.type_key) then
    raise exception 'Спершу зроби однаковий тип' using errcode = '23514';
  end if;
  /*
   * Стеля — за тим, що справді переїде: кожен код пишеться в історію окремим
   * записом, а рядки комори (чужі, без історії) міняє цей самий виклик. Пласка
   * ціна дала б картці з тисячею кодів переїхати одним викликом навіть на межі.
   */
  perform public.community_budget(10
    + (select count(*)::int from public.product_identifiers i where i.product_id = p_loser)
    + (select count(*)::int from public.products p where p.merged_into = p_loser)
    + (select count(*)::int from public.pantry_items pi where pi.product_id = p_loser));

  perform set_config('nyam.merge', 'on', true);
  perform set_config('nyam.change_op', 'merge', true);

  -- Коди переходять разом із памʼяттю, звідки прийшли (для unmerge_product).
  update public.product_identifiers i set product_id = p_winner, merged_from = p_loser
   where i.product_id = p_loser;

  -- Спершу переможений стає псевдонімом (і звільняє свою «назву+бренд+упаковку»),
  -- разом із тими, хто вже вказував на нього.
  update public.products p set merged_into = p_winner
   where p.id = p_loser or p.merged_into = p_loser;

  -- Дозаповнюємо переможця тим, чого бракує. КБЖВ — цілим блоком: половина
  -- з однієї етикетки, половина з іншої — неправда.
  update public.products p
     set kcal    = case when p.kcal is null then l.kcal    else p.kcal    end,
         protein = case when p.kcal is null then l.protein else p.protein end,
         fat     = case when p.kcal is null then l.fat     else p.fat     end,
         carbs   = case when p.kcal is null then l.carbs   else p.carbs   end,
         image_url = coalesce(p.image_url, l.image_url),
         grams_per_piece = coalesce(p.grams_per_piece, l.grams_per_piece)
   where p.id = p_winner;
  if w.pack_amount is null and l.pack_amount is not null then
    begin
      update public.products p set pack_amount = l.pack_amount, pack_unit = l.pack_unit where p.id = p_winner;
    exception when unique_violation then
      null;   -- з такою упаковкою вже є третя картка — упаковку не беремо, решта лишається
    end;
  end if;

  -- Приватні рядки комори — не в історію; тип підтягне тригер комори.
  update public.pantry_items pi set product_id = p_winner where pi.product_id = p_loser;

  perform set_config('nyam.merge', '', true);
  perform set_config('nyam.change_op', '', true);
  select * into w from public.products p where p.id = p_winner;
  return public.product_client_json(w);
end $$;

-- ── Розʼєднати ─────────────────────────────────────────────────────────────
-- Повертає рівно ті коди, що переїхали при обʼєднанні й досі на переможці.
-- Код, який після обʼєднання хтось свідомо перепривʼязав, лишається там, де є.
-- Рядки комори лишаються з переможцем: хто їх додав, той бачив саме його.
create or replace function public.unmerge_product(p_loser uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.products;
  v_winner uuid;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  perform public.community_budget(10);
  select * into l from public.products p where p.id = p_loser and p.merged_into is not null for update;
  if not found then raise exception 'Ця картка не обʼєднана' using errcode = 'P0002'; end if;
  v_winner := l.merged_into;
  perform public.community_budget(10
    + (select count(*)::int from public.product_identifiers i where i.merged_from = p_loser and i.product_id = v_winner));

  perform set_config('nyam.merge', 'on', true);
  perform set_config('nyam.change_op', 'unmerge', true);
  begin
    update public.products p set merged_into = null where p.id = p_loser;
  exception when unique_violation then
    raise exception 'Така картка вже є — обʼєднай їх' using errcode = 'P0001', hint = 'duplicate';
  end;
  update public.product_identifiers i set product_id = p_loser, merged_from = null
   where i.merged_from = p_loser and i.product_id = v_winner;

  perform set_config('nyam.merge', '', true);
  perform set_config('nyam.change_op', '', true);
  select * into l from public.products p where p.id = p_loser;
  return public.product_client_json(l);
end $$;

-- ── Обʼєднати дописані типи ────────────────────────────────────────────────
-- Що саме переїхало при кожному обʼєднанні типів — щоб його можна було
-- розʼєднати рівно назад. Картки й коди є і в community_changes, але рядки
-- комори й списку покупок приватні: в історію, яку читає кожен, їм не можна,
-- а без них «Розʼєднати» лишило б чуже молоко кефіром. Тому окрема таблиця,
-- закрита для клієнтів повністю: читають і пишуть лише функції нижче.
create table if not exists public.custom_ingredient_merges (
  id            bigint generated always as identity primary key,
  loser         text not null,
  winner        text not null,
  -- Переможець був різновидом переможеного й отримав його батька.
  winner_lifted boolean not null default false,
  loser_parent  text,
  aliases       text[] not null default '{}',   -- типи, що вже вказували на переможеного
  children      text[] not null default '{}',   -- різновиди переможеного (крім переможця)
  products      uuid[] not null default '{}',
  identifiers   uuid[] not null default '{}',
  pantry        uuid[] not null default '{}',
  shopping      uuid[] not null default '{}',
  merged_by     uuid references public.profiles (id) on delete set null,
  merged_at     timestamptz not null default now(),
  undone_at     timestamptz
);
create index if not exists custom_ingredient_merges_loser_idx on public.custom_ingredient_merges (loser, id desc);
alter table public.custom_ingredient_merges enable row level security;
revoke all on public.custom_ingredient_merges from anon, authenticated;
revoke usage, select, update on sequence public.custom_ingredient_merges_id_seq from anon, authenticated;

-- Переможений — лише own_*: вбудовані живуть у коді. Рецептів не
-- переписуємо: canonicalKey() у застосунку читає старий ключ як новий.
--
-- Типи мусять бути сумісні: один — той самий чи загальніший за інший, або в
-- них спільний батько («Кефір безлактозний» і «Кефір без лактози» — обидва
-- різновиди «Кефіру»; два самостійні — теж). «Кефір безлактозний» у «Сіль» —
-- ні: інакше будь-хто одним викликом переписав би кефір на сіль у коморах і
-- списках усіх сімей. Розʼєднати можна (unmerge_custom_ingredient).
create or replace function public.merge_custom_ingredients(p_loser text, p_winner text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.custom_ingredients;
  v_winner_parent text;
  v_lifted boolean;
  v_aliases text[];
  v_children text[];
  v_products uuid[];
  v_identifiers uuid[];
  v_pantry uuid[];
  v_shopping uuid[];
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_loser is null or p_loser !~ '^own_' or p_winner is null or p_loser = p_winner then
    raise exception 'Обʼєднати можна лише дописаний тип з іншим' using errcode = '22023';
  end if;
  perform public.community_budget(10);

  perform pg_advisory_xact_lock(hashtext('nyam:ingredient-tree'));
  select * into l from public.custom_ingredients c where c.key = p_loser and c.merged_into is null for update;
  if not found then raise exception 'Цього типу вже немає або його обʼєднано' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.builtin_ingredients b where b.key = p_winner)
     and not exists (select 1 from public.custom_ingredients c where c.key = p_winner and c.merged_into is null) then
    raise exception 'Цього типу вже немає або його обʼєднано' using errcode = 'P0002';
  end if;
  -- Ключі вбудованих і дописаних не перетинаються (own_*), тож батько — з однієї з таблиць.
  v_winner_parent := coalesce(
    (select b.parent_key from public.builtin_ingredients b where b.key = p_winner),
    (select public.canonical_type_key(c.parent_key) from public.custom_ingredients c where c.key = p_winner));
  if not public.types_compatible(p_loser, p_winner)
     and public.canonical_type_key(l.parent_key) is distinct from v_winner_parent then
    raise exception 'Спершу зроби однаковий тип' using errcode = '23514';
  end if;

  /*
   * Стеля змін — за тим, що справді переїде, а не пласкою ціною: тип із
   * тисячею карток і рядків комори інакше переписувався б одним викликом
   * навіть на межі 400 змін. Рядки комори й списку в історію не йдуть, але
   * теж рахуються: це чужі записи, які міняє цей виклик.
   */
  perform public.community_budget(10
    + (select count(*)::int from public.custom_ingredients c where c.merged_into = p_loser or c.parent_key = p_loser)
    + (select count(*)::int from public.products p where p.type_key = p_loser)
    + (select count(*)::int from public.product_identifiers i where i.type_key = p_loser)
    + (select count(*)::int from public.pantry_items pi where pi.ingredient_key = p_loser)
    + (select count(*)::int from public.shopping_items si where si.ingredient_key = p_loser));

  perform set_config('nyam.merge', 'on', true);
  perform set_config('nyam.change_op', 'merge', true);

  -- Переможець був різновидом переможеного — піднімаємо його на місце
  -- переможеного, інакше вийшло б «тип — різновид самого себе».
  with u as (
    update public.custom_ingredients c set parent_key = l.parent_key
     where c.key = p_winner and c.parent_key = p_loser returning 1)
  select exists (select 1 from u) into v_lifted;

  with u as (
    update public.custom_ingredients c set merged_into = p_winner
     where c.merged_into = p_loser returning c.key)
  select coalesce(array_agg(key), '{}') into v_aliases from u;
  update public.custom_ingredients c set merged_into = p_winner where c.key = p_loser;
  -- Різновиди переможеного стають різновидами переможця (канонічний тригер).
  with u as (
    update public.custom_ingredients c set parent_key = p_winner
     where c.parent_key = p_loser returning c.key)
  select coalesce(array_agg(key), '{}') into v_children from u;

  -- Рядки комори з товаром цього типу переведе тригер products_type_to_pantry,
  -- і так само назад при розʼєднанні — окремо їх не памʼятаємо.
  with u as (update public.products p set type_key = p_winner where p.type_key = p_loser returning p.id)
  select coalesce(array_agg(id), '{}') into v_products from u;
  with u as (update public.product_identifiers i set type_key = p_winner where i.type_key = p_loser returning i.id)
  select coalesce(array_agg(id), '{}') into v_identifiers from u;
  -- Приватні рядки — без історії; RLS тут не діє (definer), це свідомо.
  with u as (update public.pantry_items pi set ingredient_key = p_winner where pi.ingredient_key = p_loser returning pi.id)
  select coalesce(array_agg(id), '{}') into v_pantry from u;
  with u as (update public.shopping_items si set ingredient_key = p_winner where si.ingredient_key = p_loser returning si.id)
  select coalesce(array_agg(id), '{}') into v_shopping from u;

  insert into public.custom_ingredient_merges
    (loser, winner, winner_lifted, loser_parent, aliases, children, products, identifiers, pantry, shopping, merged_by)
  values (p_loser, p_winner, v_lifted, l.parent_key, v_aliases, v_children, v_products, v_identifiers,
          v_pantry, v_shopping, auth.uid());

  perform set_config('nyam.merge', '', true);
  perform set_config('nyam.change_op', '', true);
end $$;

-- ── Розʼєднати типи ────────────────────────────────────────────────────────
-- Повертає рівно те, що переїхало при останньому обʼєднанні цього типу й
-- відтоді лишилось на переможці. Те, що після обʼєднання хтось свідомо змінив
-- (картку перевели в інший тип, рядок комори — в інший), лишається як є.
create or replace function public.unmerge_custom_ingredient(p_loser text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.custom_ingredient_merges;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_loser is null or p_loser !~ '^own_' then
    raise exception 'Розʼєднати можна лише дописаний тип' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('nyam:ingredient-tree'));
  select * into r from public.custom_ingredient_merges m
   where m.loser = p_loser and m.undone_at is null
   order by m.id desc limit 1 for update;
  -- Переможця відтоді обʼєднали ще з кимось — спершу розʼєднати його.
  if not found or not exists (select 1 from public.custom_ingredients c
                               where c.key = p_loser and c.merged_into = r.winner) then
    raise exception 'Цей тип не обʼєднаний (або його переможця обʼєднали далі)' using errcode = 'P0002';
  end if;
  perform public.community_budget(1 + cardinality(r.aliases) + cardinality(r.children) + cardinality(r.products)
                                  + cardinality(r.identifiers) + cardinality(r.pantry) + cardinality(r.shopping));

  perform set_config('nyam.merge', 'on', true);
  perform set_config('nyam.change_op', 'unmerge', true);

  -- Спершу сам тип: поки він псевдонім, канонічні тригери переписали б усе назад на переможця.
  update public.custom_ingredients c set merged_into = null where c.key = p_loser;
  update public.custom_ingredients c set merged_into = p_loser
   where c.key = any (r.aliases) and c.merged_into = r.winner;
  if r.winner_lifted then
    update public.custom_ingredients c set parent_key = p_loser
     where c.key = r.winner and c.parent_key is not distinct from r.loser_parent;
  end if;
  update public.custom_ingredients c set parent_key = p_loser
   where c.key = any (r.children) and c.parent_key = r.winner;

  update public.products p set type_key = p_loser where p.id = any (r.products) and p.type_key = r.winner;
  update public.product_identifiers i set type_key = p_loser where i.id = any (r.identifiers) and i.type_key = r.winner;
  update public.pantry_items pi set ingredient_key = p_loser where pi.id = any (r.pantry) and pi.ingredient_key = r.winner;
  update public.shopping_items si set ingredient_key = p_loser where si.id = any (r.shopping) and si.ingredient_key = r.winner;

  update public.custom_ingredient_merges m set undone_at = now() where m.id = r.id;
  perform set_config('nyam.merge', '', true);
  perform set_config('nyam.change_op', '', true);
end $$;

-- ── Права ──────────────────────────────────────────────────────────────────
revoke all on function public.custom_ingredients_canonical() from public, anon, authenticated;
revoke all on function public.catalog_canonical_type()       from public, anon, authenticated;
revoke all on function public.types_compatible(text, text)   from public, anon, authenticated;
-- canonical_type_key кличуть invoker-тригери від імені того, хто пише (і
-- старий клієнт, що вставляє дописаний тип напряму), — тож authenticated
-- мусить мати EXECUTE. Показує лише те, що й так видно в custom_ingredients.
revoke all on function public.canonical_type_key(text)       from public, anon, authenticated;
grant execute on function public.canonical_type_key(text)    to authenticated;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.merge_products(uuid, uuid)',
    'public.unmerge_product(uuid)',
    'public.merge_custom_ingredients(text, text)',
    'public.unmerge_custom_ingredient(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
