-- ============================================================================
--  Ням — щоденник харчування: що, скільки й хто зʼїв.
--
--  Виконувати в Supabase → SQL Editor після family.sql (тут потрібна
--  shares_family) і realtime.sql. Скрипт ідемпотентний.
--
--  ДО деплою коду: застосунок читає products.nutrition_source і нові таблиці
--  щоденника — без них комора й щоденник не завантажаться.
--
--  Що тут:
--  1. products.nutrition_source — звідки КБЖВ товару: з етикетки чи оцінка ШІ.
--     Оцінку показуємо з позначкою «≈ ШІ», а етикетка її завжди перебʼє.
--  2. diary_settings — ціль калорій і БЖВ, «апетит» (скільки порцій людина
--     зʼїдає відносно інших) і чи видно щоденник сімʼї.
--  3. meals — страва, яку приготували на кількох: рецепт або «запечена
--     картопля з сосискою». Знає свій склад і КБЖВ усієї страви, а скільки з
--     неї вже зʼїли, веде база — так видно залишок.
--  4. food_log — записи щоденника: товар (батончик, грами) або частка страви.
--     Кухар може записати частку й тому, хто їв із ним.
--  5. api_tokens — ключі для голосового помічника (MCP, /api/mcp).
--
--  pantry_taken у стравах і записах — що взяли з комори: рядок до списання
--  й скільки з нього пішло. Прибрали помилковий запис — це повертається.
-- ============================================================================

-- ── 1. Звідки КБЖВ товару ───────────────────────────────────────────────────

-- null — невідомо (картки до цього файлу: їх вписували люди чи Open Food Facts,
-- тобто з етикетки). 'label' — з упаковки; 'ai' — оцінка моделі за назвою.
alter table public.products
  add column if not exists nutrition_source text;
alter table public.products drop constraint if exists products_nutrition_source;
alter table public.products add constraint products_nutrition_source
  check (nutrition_source is null or nutrition_source in ('label', 'ai'));

grant select (nutrition_source) on public.products to anon, authenticated;

create or replace function public.product_client_json(p public.products)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'type_key', p.type_key, 'name', p.name, 'brand', p.brand, 'fat_pct', p.fat_pct,
    'pack_amount', p.pack_amount, 'pack_unit', p.pack_unit, 'grams_per_piece', p.grams_per_piece,
    'kcal', p.kcal, 'protein', p.protein, 'fat', p.fat, 'carbs', p.carbs, 'image_url', p.image_url,
    'nutrition_source', p.nutrition_source,
    'source', p.source, 'archived', p.archived, 'merged_into', p.merged_into, 'version', p.version,
    'updated_at', p.updated_at)
$$;
revoke all on function public.product_client_json(public.products) from public, anon, authenticated;

-- Нова колонка у відповіді — тип результату змінився, тож саме drop, а не replace.
drop function if exists public.search_products(text, text[], int);
create function public.search_products(p_query text, p_type_keys text[] default null, p_limit int default 20)
returns table (id uuid, type_key text, name text, brand text, fat_pct numeric, pack_amount numeric, pack_unit text,
               grams_per_piece numeric, kcal numeric, protein numeric, fat numeric, carbs numeric,
               image_url text, nutrition_source text, source text, archived boolean, merged_into uuid,
               version int, updated_at timestamptz)
language plpgsql stable set search_path = public as $$
#variable_conflict use_column
declare
  v_text text := lower(btrim(coalesce(p_query, '')));
  v_pats text[];
begin
  select array_agg('%' || replace(replace(t, '%', '\%'), '_', '\_') || '%' order by char_length(t) desc)
    into v_pats
    from regexp_split_to_table(v_text, '[^0-9a-zа-яёіїєґ]+') t
   where char_length(t) >= 2;
  if v_pats is null then return; end if;
  perform set_config('pg_trgm.word_similarity_threshold', '0.4', true);
  return query
    select p.id, p.type_key, p.name, p.brand, p.fat_pct, p.pack_amount, p.pack_unit, p.grams_per_piece,
           p.kcal, p.protein, p.fat, p.carbs, p.image_url, p.nutrition_source, p.source, p.archived,
           p.merged_into, p.version, p.updated_at
      from public.products p
     where p.merged_into is null and not p.archived
       and (p_type_keys is null or p.type_key = any (p_type_keys))
       and (p.search_key like v_pats[1] or v_text <% p.search_key)          -- індексовані умови
       and (p.search_key like all (v_pats) or v_text <% p.search_key)       -- перевірка всіх слів
     order by (p.search_key like all (v_pats)) desc, word_similarity(v_text, p.search_key) desc, p.updated_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;
revoke all on function public.search_products(text, text[], int) from public, anon, authenticated;
grant execute on function public.search_products(text, text[], int) to anon, authenticated;

/*
 * save_product — та сама, що в schema.sql, плюс nutrition_source.
 *
 * Джерело йде разом із числами: без КБЖВ його немає; з картки беремо лише
 * 'label' чи 'ai'. Правка, що не міняє чисел, джерела не чіпає — інакше
 * перейменування оцінки ШІ робило б її «етикеткою».
 */
create or replace function public.save_product(p_id uuid, p_expected_version int, p_card jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row   public.products;
  v_old   public.products;
  v_name  text;
  v_brand text;
  v_src   text;
  v_nsrc  text;
  v_pack_amount numeric;
  v_pack_unit   text;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_card is null or jsonb_typeof(p_card) <> 'object' then
    raise exception 'Порожня картка' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_card->>'type_key', '')), '') is null then
    raise exception 'Обери тип товару' using errcode = '22023';
  end if;
  perform public.community_budget(1);

  v_name  := nullif(btrim(regexp_replace(coalesce(p_card->>'name', ''), '\s+', ' ', 'g')), '');
  v_brand := nullif(btrim(regexp_replace(coalesce(p_card->>'brand', ''), '\s+', ' ', 'g')), '');
  v_src   := case when p_card->>'source' in ('off', 'receipt') then p_card->>'source' else 'user' end;
  v_nsrc  := case when p_card->>'nutrition_source' in ('label', 'ai') then p_card->>'nutrition_source' end;
  v_pack_amount := (p_card->>'pack_amount')::numeric;
  v_pack_unit   := nullif(p_card->>'pack_unit', '');

  if p_id is null then
    insert into public.products as t (type_key, name, brand, fat_pct, pack_amount, pack_unit, grams_per_piece,
                                      kcal, protein, fat, carbs, image_url, source, nutrition_source)
    values (p_card->>'type_key', v_name, v_brand, (p_card->>'fat_pct')::numeric, v_pack_amount, v_pack_unit,
            (p_card->>'grams_per_piece')::numeric, (p_card->>'kcal')::numeric, (p_card->>'protein')::numeric,
            (p_card->>'fat')::numeric, (p_card->>'carbs')::numeric, nullif(p_card->>'image_url', ''), v_src,
            case when (p_card->>'kcal') is not null then coalesce(v_nsrc, 'label') end)
    on conflict (identity_key) where merged_into is null and not archived do nothing
    returning * into v_row;
    if found then
      return jsonb_build_object('status', 'created', 'product', public.product_client_json(v_row));
    end if;
    select * into v_row from public.products p
     where p.identity_key = public.product_identity_key(v_name, v_brand, v_pack_amount, v_pack_unit)
       and p.merged_into is null and not p.archived;
    return jsonb_build_object('status', 'duplicate', 'product', public.product_client_json(v_row));
  end if;

  if p_expected_version is null then
    raise exception 'Бракує номера версії картки' using errcode = '22023';
  end if;
  select * into v_old from public.products p where p.id = p_id;
  begin
    update public.products p
       set type_key = p_card->>'type_key', name = v_name, brand = v_brand,
           fat_pct = (p_card->>'fat_pct')::numeric, pack_amount = v_pack_amount, pack_unit = v_pack_unit,
           grams_per_piece = (p_card->>'grams_per_piece')::numeric, kcal = (p_card->>'kcal')::numeric,
           protein = (p_card->>'protein')::numeric, fat = (p_card->>'fat')::numeric,
           carbs = (p_card->>'carbs')::numeric, image_url = nullif(p_card->>'image_url', ''),
           nutrition_source = case
             when (p_card->>'kcal') is null then null
             when v_nsrc is not null then v_nsrc
             when (p_card->>'kcal')::numeric is not distinct from v_old.kcal
              and (p_card->>'protein')::numeric is not distinct from v_old.protein
              and (p_card->>'fat')::numeric is not distinct from v_old.fat
              and (p_card->>'carbs')::numeric is not distinct from v_old.carbs then v_old.nutrition_source
             else 'label'
           end
     where p.id = p_id and p.version = p_expected_version and not p.archived and p.merged_into is null
    returning * into v_row;
  exception when unique_violation then
    select * into v_row from public.products p
     where p.identity_key = public.product_identity_key(v_name, v_brand, v_pack_amount, v_pack_unit)
       and p.merged_into is null and not p.archived and p.id <> p_id;
    return jsonb_build_object('status', 'duplicate', 'product', public.product_client_json(v_row));
  end;
  if not found then
    if exists (select 1 from public.products p where p.id = p_id and (p.archived or p.merged_into is not null)) then
      raise exception 'Картку прибрали або обʼєднали — онови її' using errcode = '40001', hint = 'catalog_conflict';
    end if;
    perform public.catalog_stale_or_missing('products', p_id::text);
  end if;
  return jsonb_build_object('status', 'updated', 'product', public.product_client_json(v_row));
end $$;
revoke all on function public.save_product(uuid, int, jsonb) from public, anon, authenticated;
grant execute on function public.save_product(uuid, int, jsonb) to authenticated;

/*
 * Повернення версії картки повертає й джерело КБЖВ: інакше оцінка ШІ, на яку
 * відкотили етикетку, лишилась би підписаною як «з етикетки».
 */
create or replace function public.restore_community_version(p_change_id bigint, p_expected_version int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_change public.community_changes;
  p public.products;
  i public.product_identifiers;
  c public.custom_ingredients;
  v_pid uuid;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  perform public.community_budget(1);
  select * into v_change from public.community_changes ch where ch.id = p_change_id;
  if not found or v_change.after is null then
    raise exception 'Цієї версії немає' using errcode = 'P0002';
  end if;
  perform set_config('nyam.revert_of', v_change.id::text, true);

  if v_change.table_name = 'products' then
    p := jsonb_populate_record(null::public.products, v_change.after);
    begin
      update public.products t
         set type_key = p.type_key, name = p.name, brand = p.brand, fat_pct = p.fat_pct,
             pack_amount = p.pack_amount, pack_unit = p.pack_unit, grams_per_piece = p.grams_per_piece,
             kcal = p.kcal, protein = p.protein, fat = p.fat, carbs = p.carbs, image_url = p.image_url,
             nutrition_source = case when p.kcal is not null then p.nutrition_source end,
             archived = p.archived
       where t.id = p.id and t.version = p_expected_version;
    exception when unique_violation then
      raise exception 'Така картка вже є — обʼєднай їх' using errcode = 'P0001', hint = 'duplicate';
    end;
    if not found then perform public.catalog_stale_or_missing('products', v_change.row_id); end if;

  elsif v_change.table_name = 'product_identifiers' then
    i := jsonb_populate_record(null::public.product_identifiers, v_change.after);
    if i.product_id is not null then
      select coalesce(x.merged_into, x.id) into v_pid from public.products x where x.id = i.product_id;
    end if;
    if exists (select 1 from public.product_identifiers t where t.id = i.id) then
      update public.product_identifiers t
         set product_id = v_pid, type_key = case when v_pid is null then i.type_key end
       where t.id = i.id and t.version = p_expected_version;
      if not found then perform public.catalog_stale_or_missing('product_identifiers', v_change.row_id); end if;
    else
      begin
        insert into public.product_identifiers (id, kind, scope, raw, product_id, type_key, source, created_by)
        values (i.id, i.kind, i.scope, i.raw, v_pid, case when v_pid is null then i.type_key end, i.source, null);
      exception when unique_violation then
        raise exception 'Цей код уже привʼязаний до іншого' using errcode = '23505';
      end;
    end if;

  elsif v_change.table_name = 'custom_ingredients' then
    c := jsonb_populate_record(null::public.custom_ingredients, v_change.after);
    update public.custom_ingredients t
       set label = c.label, emoji = c.emoji, cat = c.cat, aliases = c.aliases, staple = c.staple,
           grams_per_piece = c.grams_per_piece, grams_per_cup = c.grams_per_cup, default_unit = c.default_unit,
           kcal = c.kcal, protein = c.protein, fat = c.fat, carbs = c.carbs, parent_key = c.parent_key
     where t.key = c.key and t.version = p_expected_version;
    if not found then perform public.catalog_stale_or_missing('custom_ingredients', v_change.row_id); end if;

  else
    raise exception 'Невідома таблиця історії' using errcode = '22023';
  end if;

  perform set_config('nyam.revert_of', '', true);
end $$;
revoke all on function public.restore_community_version(bigint, int) from public, anon, authenticated;
grant execute on function public.restore_community_version(bigint, int) to authenticated;

-- ── 2. Налаштування щоденника ───────────────────────────────────────────────

create table if not exists public.diary_settings (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  -- Ціль калорій на день; null — без цілі (щоденник просто рахує).
  kcal_goal   int check (kcal_goal is null or kcal_goal between 500 and 10000),
  -- Цілі БЖВ на день, г; null — без цілі. За ними помічник складає меню з рецептів.
  protein_goal int check (protein_goal is null or protein_goal between 1 and 1000),
  fat_goal     int check (fat_goal is null or fat_goal between 1 and 1000),
  carbs_goal   int check (carbs_goal is null or carbs_goal between 1 and 1000),
  -- Скільки людина зʼїдає відносно «звичайної» порції: 1,5 — у півтора раза більше.
  -- За ним застосунок пропонує, як поділити спільну страву.
  appetite    numeric(3,2) not null default 1 check (appetite between 0.25 and 4),
  -- Чи бачить сімʼя цей щоденник. Те, що записав тобі кухар, видно йому завжди.
  share_diary boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- Базі, створеній до цілей БЖВ.
alter table public.diary_settings
  add column if not exists protein_goal int check (protein_goal is null or protein_goal between 1 and 1000),
  add column if not exists fat_goal     int check (fat_goal is null or fat_goal between 1 and 1000),
  add column if not exists carbs_goal   int check (carbs_goal is null or carbs_goal between 1 and 1000);

alter table public.diary_settings enable row level security;

-- Сімʼя читає апетит (без нього не поділити страву) і чи відкритий щоденник.
drop policy if exists "diary settings readable" on public.diary_settings;
create policy "diary settings readable" on public.diary_settings for select
  using ((select auth.uid()) = user_id or public.shares_family(user_id));
drop policy if exists "diary settings own" on public.diary_settings;
create policy "diary settings own" on public.diary_settings for insert
  with check ((select auth.uid()) = user_id);
drop policy if exists "diary settings own update" on public.diary_settings;
create policy "diary settings own update" on public.diary_settings for update
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop trigger if exists diary_settings_touch on public.diary_settings;
create trigger diary_settings_touch before update on public.diary_settings
  for each row execute function public.touch_updated_at();

-- ── 3. Страви ───────────────────────────────────────────────────────────────

create table if not exists public.meals (
  -- id дає застосунок: страва й записи щоденника створюються офлайн разом.
  id         uuid primary key,
  -- Хто готував. Страву бачить і править уся сімʼя — як комору.
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Рецепт, за яким готували. Без FK, як shopping_items.recipe_id: рецепт,
  -- щойно створений офлайн, доходить у базу пізніше.
  recipe_id  uuid,
  title      text not null check (char_length(btrim(title)) between 1 and 120),
  emoji      text check (emoji is null or char_length(emoji) <= 16),
  -- Скільки порцій вийшло: у цих порціях люди й кажуть, скільки зʼїли.
  servings   numeric(5,2) not null default 1 check (servings > 0 and servings <= 50),
  -- КБЖВ усієї страви; null — не знаємо (рецепт ще не порахований).
  kcal       numeric(8,1) check (kcal is null or kcal between 0 and 30000),
  protein    numeric(7,1) check (protein is null or protein >= 0),
  fat        numeric(7,1) check (fat is null or fat >= 0),
  carbs      numeric(7,1) check (carbs is null or carbs >= 0),
  -- Склад: [{ name, grams, productId?, typeKey?, pantryId?, kcal, protein, fat, carbs, from }].
  -- З нього складено число — щоб «чому тут 900 ккал» мало відповідь.
  items      jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  -- Припущення ШІ, від яких число залежить найбільше.
  note       text check (note is null or char_length(note) <= 300),
  cooked_at  timestamptz not null default now(),
  -- Яку частку страви вже записали в щоденники (0..1). Веде база.
  eaten      numeric(5,3) not null default 0,
  -- «Доїли / викинули»: залишком більше не пропонуємо.
  finished   boolean not null default false,
  -- Що страва взяла з комори: [{ row, amount }] — рядок (як у застосунку) до
  -- списання й скільки з нього пішло в його одиницях. null — ще не вирішили
  -- (записали голосом, чекає підтвердження); [] — з комори нічого не брали.
  pantry_taken jsonb check (pantry_taken is null or jsonb_typeof(pantry_taken) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meals add column if not exists pantry_taken jsonb;

create index if not exists meals_user_idx on public.meals (user_id, cooked_at desc);

alter table public.meals enable row level security;
drop policy if exists "meals own or family" on public.meals;
create policy "meals own or family" on public.meals for all
  using ((select auth.uid()) = user_id or public.shares_family(user_id))
  with check ((select auth.uid()) = user_id or public.shares_family(user_id));

/*
 * Сторож страви: «скільки зʼїли» клієнт не пише — його рахують записи
 * щоденника, частину яких клієнт навіть не бачить (чужий приватний щоденник).
 * Хто готував, не міняється: інакше залишок «переїжджав» би до того, хто
 * останнім торкнувся страви.
 */
create or replace function public.meals_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  from_client constant boolean := current_user in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    if from_client then new.eaten := 0; end if;
  else
    new.user_id := old.user_id;
    if from_client then new.eaten := old.eaten; end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists meals_before_write on public.meals;
create trigger meals_before_write before insert or update on public.meals
  for each row execute function public.meals_before_write();

-- ── 4. Записи щоденника ─────────────────────────────────────────────────────

create table if not exists public.food_log (
  id         uuid primary key,
  -- Чий це шлунок.
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Хто записав: сам або кухар, що ділив страву. Ставить база.
  logged_by  uuid references public.profiles (id) on delete set null,
  eaten_at   timestamptz not null default now(),
  slot       text not null check (slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  title      text not null check (char_length(btrim(title)) between 1 and 160),
  emoji      text check (emoji is null or char_length(emoji) <= 16),
  -- Товар (батончик, йогурт). Без FK, як у коморі.
  product_id uuid,
  -- Або частка страви. Без FK: страва й запис летять у базу окремими запитами.
  meal_id    uuid,
  share      numeric(5,3) check (share is null or (share > 0 and share <= 1)),
  grams      numeric(8,1) check (grams is null or (grams > 0 and grams <= 10000)),
  -- Зʼїдене (не на 100 г). Для частки страви база тримає його рівним страві × частка.
  kcal       numeric(8,1) check (kcal is null or kcal between 0 and 20000),
  protein    numeric(7,1) check (protein is null or protein >= 0),
  fat        numeric(7,1) check (fat is null or fat >= 0),
  carbs      numeric(7,1) check (carbs is null or carbs >= 0),
  source     text not null default 'manual'
             check (source in ('scan', 'search', 'dish', 'cook', 'leftover', 'voice', 'manual')),
  -- Що цей запис узяв із комори (батончик із холодильника) — як у meals.
  pantry_taken jsonb check (pantry_taken is null or jsonb_typeof(pantry_taken) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint food_log_share_needs_meal check (share is null or meal_id is not null)
);

alter table public.food_log add column if not exists pantry_taken jsonb;

create index if not exists food_log_user_idx on public.food_log (user_id, eaten_at desc);
create index if not exists food_log_meal_idx on public.food_log (meal_id) where meal_id is not null;
create index if not exists food_log_logger_idx on public.food_log (logged_by, eaten_at desc);

alter table public.food_log enable row level security;

/*
 * Читати: своє; те, що записав сам (частку, яку дав дівчині); і щоденник
 * людини з сімʼї, якщо вона його відкрила (diary_settings.share_diary).
 * Писати: собі або комусь із сімʼї. Правити й прибирати: своє або записане тобою.
 */
drop policy if exists "food log readable" on public.food_log;
create policy "food log readable" on public.food_log for select using (
  (select auth.uid()) = user_id
  or (select auth.uid()) = logged_by
  or (public.shares_family(user_id)
      and exists (select 1 from public.diary_settings s where s.user_id = food_log.user_id and s.share_diary))
);
drop policy if exists "food log insert" on public.food_log;
create policy "food log insert" on public.food_log for insert
  with check ((select auth.uid()) = user_id or public.shares_family(user_id));
drop policy if exists "food log update" on public.food_log;
create policy "food log update" on public.food_log for update
  using ((select auth.uid()) = user_id or (select auth.uid()) = logged_by)
  with check ((select auth.uid()) = user_id or public.shares_family(user_id));
drop policy if exists "food log delete" on public.food_log;
create policy "food log delete" on public.food_log for delete
  using ((select auth.uid()) = user_id or (select auth.uid()) = logged_by);

-- Хто записав і чий це запис — не підробити: перше ставить база, друге незмінне.
create or replace function public.food_log_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.logged_by := coalesce(auth.uid(), new.logged_by);
  else
    new.user_id := old.user_id;
    new.logged_by := old.logged_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists food_log_before_write on public.food_log;
create trigger food_log_before_write before insert or update on public.food_log
  for each row execute function public.food_log_before_write();

/*
 * Скільки страви зʼїли — сума часток усіх записів, і тих, яких клієнт не
 * бачить. Тому definer. Перераховуємо з нуля, а не додаємо дельту: запис і
 * страва летять у базу окремо, і хто прийде першим, невідомо.
 */
create or replace function public.recount_meal_eaten(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.meals m
     set eaten = least(1, coalesce((select sum(f.share) from public.food_log f where f.meal_id = m.id), 0))
   where m.id = any (p_ids);
$$;
revoke all on function public.recount_meal_eaten(uuid[]) from public, anon, authenticated;

create or replace function public.food_log_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recount_meal_eaten(array_remove(array[
    case when tg_op <> 'INSERT' then old.meal_id end,
    case when tg_op <> 'DELETE' then new.meal_id end
  ], null));
  return null;
end;
$$;

drop trigger if exists food_log_after_write on public.food_log;
create trigger food_log_after_write
  after insert or delete or update of meal_id, share on public.food_log
  for each row execute function public.food_log_after_write();

/*
 * Після запису страви: нова — порахувати, скільки з неї вже записано (записи
 * могли прийти першими); змінилось КБЖВ — переписати зʼїдене в усіх, хто її
 * їв, і в тих щоденниках, яких кухар не бачить.
 */
create or replace function public.meals_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recount_meal_eaten(array[new.id]);
    return null;
  end if;
  if (new.kcal, new.protein, new.fat, new.carbs) is distinct from (old.kcal, old.protein, old.fat, old.carbs) then
    update public.food_log f
       set kcal    = round(new.kcal * f.share, 1),
           protein = round(new.protein * f.share, 1),
           fat     = round(new.fat * f.share, 1),
           carbs   = round(new.carbs * f.share, 1)
     where f.meal_id = new.id and f.share is not null;
  end if;
  return null;
end;
$$;

drop trigger if exists meals_after_write on public.meals;
create trigger meals_after_write after insert or update on public.meals
  for each row execute function public.meals_after_write();

-- Записи, що прийшли раніше за страву, — врахувати й ті, що вже лежать.
select public.recount_meal_eaten(array_agg(id)) from public.meals;

-- ── 5. Ключі голосового помічника ───────────────────────────────────────────

/*
 * Ключ для MCP (/api/mcp): Gemini, Claude чи будь-який інший клієнт заходить
 * ним від імені людини. Сам ключ не зберігаємо — лише sha256: базу прочитали,
 * а ключів у ній немає. Показуємо його один раз, при створенні.
 */
create table if not exists public.api_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  label        text not null check (char_length(btrim(label)) between 1 and 60),
  token_hash   text not null unique,
  -- Останні чотири символи — впізнати ключ у списку.
  hint         text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists api_tokens_user_idx on public.api_tokens (user_id);

alter table public.api_tokens enable row level security;
revoke all on public.api_tokens from anon, authenticated;
grant select (id, label, hint, created_at, last_used_at), delete on public.api_tokens to authenticated;
drop policy if exists "api tokens own" on public.api_tokens;
create policy "api tokens own" on public.api_tokens for select using ((select auth.uid()) = user_id);
drop policy if exists "api tokens revoke own" on public.api_tokens;
create policy "api tokens revoke own" on public.api_tokens for delete using ((select auth.uid()) = user_id);

create or replace function public.create_api_token(p_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_row   public.api_tokens;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if (select count(*) from public.api_tokens t where t.user_id = auth.uid()) >= 10 then
    raise exception 'Забагато ключів — прибери старий' using errcode = 'P0001';
  end if;
  v_token := 'nyam_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.api_tokens (user_id, label, token_hash, hint)
  values (auth.uid(), coalesce(nullif(left(btrim(p_label), 60), ''), 'Помічник'),
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), right(v_token, 4))
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'label', v_row.label, 'hint', v_row.hint,
                            'created_at', v_row.created_at, 'token', v_token);
end;
$$;
revoke all on function public.create_api_token(text) from public, anon, authenticated;
grant execute on function public.create_api_token(text) to authenticated;

-- ── Живі оновлення ──────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array['food_log', 'meals', 'diary_settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

alter table public.food_log replica identity full;
alter table public.meals    replica identity full;

notify pgrst, 'reload schema';
