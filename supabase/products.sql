-- ============================================================================
--  Ням — спільні картки товарів, штрихкоди й назви з чеків, історія правок.
--
--  Виконувати в Supabase → SQL Editor після schema.sql, family.sql,
--  custom-ingredients.sql, builtin-ingredients.sql і ingredient-parents.sql.
--  Від комори не залежить: pantry-receipt-name.sql можна і до, і після
--  (на живій базі порядок — у README, «Товари й комора по товарах»).
--  Скрипт ідемпотентний. Код із товарами деплоїти лише ПІСЛЯ цього файлу:
--  нові select-и й RPC без нього падають.
--
--  Свіжа база з schema.sql (setup.sql) усе це вже має — файл для баз,
--  створених раніше; на новій повторний запуск нічого не змінює.
--
--  Навіщо. Досі тип («Молоко») був єдиним, що база знала про пачку в руках.
--  Назва «Молоко Галичина 2,5% 900 мл», вага пачки й КБЖВ жили в приватній
--  коморі однієї людини, а довідник штрихкодів умів лише «цей код — молоко».
--  Тепер три шари:
--    - тип — ключ каталогу (вбудований або own_*), як і був;
--    - товар (products) — спільна картка з назвою, брендом, упаковкою, КБЖВ;
--    - ідентифікатор (product_identifiers) — EAN або назва з чека, що вказує
--      на товар або лише на тип («ІмбирКг» — просто імбир, картка не потрібна).
--
--  Правила, на яких усе тримається:
--    - клієнти таблиці лише читають, і то не всі колонки: хто створив картку й
--      коли, хто навчив код — закрито (разом із місцем покупки це видало б, де
--      й коли людина ходила в магазин);
--    - пише тільки security definer RPC з номером версії: застаріла правка —
--      40001 з hint catalog_conflict, а не тихий перезапис чужої;
--    - кожна зміна лягає в community_changes, будь-яку версію можна повернути;
--      картки й дописані типи не видаляються ніколи — лише «прибрати»;
--    - нормалізацію (normalize_ean, receipt_name_key, receipt_scope) рахує
--      лише база: клієнт шле сирі стрічки, тож дві версії застосунку не
--      розійдуться в тому, що вважати «тим самим кодом»;
--    - права за замовчуванням Supabase дають anon і authenticated EXECUTE на
--      кожну нову функцію й ALL на кожну нову таблицю, тому кожен обʼєкт тут
--      закритий явно, а відкрите — відкрите свідомо.
--
--  Старий застосунок (до товарів) цих таблиць не знає. Він і далі читає й
--  пише barcode_cache (його рядки переносимо сюди нижче й ще раз на
--  контрактному кроці) і створює дописані типи прямим insert — це право
--  лишається. Правити дописані типи він не вмів ніколи, тож закрите UPDATE
--  його не зачіпає.
-- ============================================================================

create extension if not exists pg_trgm;

-- ── Нормалізація: одна правда на всіх клієнтів ─────────────────────────────
-- Чисті функції, anon і authenticated можуть їх викликати навмисно: так
-- npm run db:check перевіряє, що база рахує ключі так само, як у тестах.

-- EAN-8 / EAN-13 (UPC-A доповнюється нулем) — або null, якщо код не товарний.
create or replace function public.normalize_ean(raw text)
returns text language plpgsql immutable parallel safe set search_path = pg_catalog as $$
declare d text := regexp_replace(coalesce(raw, ''), '\D', '', 'g'); n int; s int := 0; i int;
begin
  if length(d) = 12 then d := '0' || d; end if;                 -- UPC-A → EAN-13
  n := length(d);
  if n not in (8, 13) then return null; end if;
  -- Внутрішні коди магазину (вагові, цінники): EAN-13 з 2…, 02…, 04…; EAN-8 з 2….
  -- Той самий код у двох магазинах — різні товари, вчити за ним не можна.
  if (n = 13 and (d like '2%' or d like '02%' or d like '04%')) or (n = 8 and d like '2%') then return null; end if;
  -- Заглушки кас: «4820000000000» — після префікса самі нулі; або одна цифра
  -- всюди. Справжні коди можуть мати нулі посередині, тож лише «весь хвіст».
  if substr(d, 4, n - 4) ~ '^0+$' or d ~ '^(\d)\1+$' then return null; end if;
  for i in 1 .. n - 1 loop
    s := s + substr(d, n - i, 1)::int * case when i % 2 = 1 then 3 else 1 end;
  end loop;
  if (10 - s % 10) % 10 <> substr(d, n, 1)::int then return null; end if;
  return d;
end $$;

-- Ключ назви з чека. RECEIPT_KEY_VERSION = 1: змінити функцію — означає
-- перерахувати value з raw одним update (тригер нижче рахує value з raw).
-- Лишає цифри, десяткову крапку й %: «Молоко 1,5%» і «Молоко 15%», 900 г і
-- 950 г — різні товари. Пробіли, розділові знаки, регістр і латинські
-- двійники кирилиці в змішаному слові («МОЛOКО» з латинською O) — зникають.
create or replace function public.receipt_name_key(raw text)
returns text language plpgsql immutable parallel safe set search_path = pg_catalog as $$
declare tok text; k text := '';
begin
  if raw is null then return null; end if;
  foreach tok in array regexp_split_to_array(
      regexp_replace(raw, '(\d)\s*[.,]\s*(\d)', '\1.\2', 'g'),      -- «2,5» і «2 . 5» → «2.5»
      '[^0-9A-Za-zА-Яа-яЁёІіЇїЄєҐґ.%]+') loop
    -- Лише мішанина алфавітів: «McCain» лишається латиницею, «МОЛOКО» стає кирилицею.
    if tok ~ '[A-Za-z]' and tok ~ '[А-Яа-яЁёІіЇїЄєҐґ]' then
      tok := translate(tok, 'AaBCcEeHIiKkMOoPpTXxYy', 'АаВСсЕеНІіКкМОоРрТХхУу');
    end if;
    k := k || regexp_replace(lower(tok), '(?<!\d)\.|\.(?!\d)', '', 'g');  -- крапка лишається лише між цифрами
  end loop;
  k := left(k, 160);
  return case when char_length(k) >= 3 then k end;
end $$;

-- Область назви з чека. Власні марки мереж звуться однаково, а означають
-- різне, тож назва з АТБ спершу вчиться для АТБ. Рахується ЛИШЕ всередині RPC
-- із сирих p_seller (продавець із чека) і p_chain (slug із chainOf).
create or replace function public.receipt_scope(p_seller text, p_chain text)
returns text language sql immutable parallel safe set search_path = public as $$
  select case
    when p_chain ~ '^[a-z0-9_]{2,24}$' then 'm:' || p_chain
    when public.receipt_name_key(p_seller) is not null then 's:' || left(public.receipt_name_key(p_seller), 60)
    else '' end
$$;

-- «Та сама назва + той самий бренд + та сама упаковка» — той самий товар.
-- Окремою функцією, бо нею ж save_product шукає, з ким саме збіглась картка.
-- 0,9 л і 900 мл — одна упаковка.
create or replace function public.product_identity_key(p_name text, p_brand text, p_pack_amount numeric, p_pack_unit text)
returns text language sql immutable parallel safe set search_path = pg_catalog as $$
  select lower(regexp_replace(btrim(p_name), '\s+', ' ', 'g')) || '|' ||
         lower(regexp_replace(btrim(coalesce(p_brand, '')), '\s+', ' ', 'g')) || '|' ||
         coalesce(trim_scale(p_pack_amount * case p_pack_unit when 'kg' then 1000 when 'l' then 1000 else 1 end)::text
                  || case p_pack_unit when 'kg' then 'g' when 'l' then 'ml' else p_pack_unit end, '')
$$;

revoke all on function public.normalize_ean(text)          from public, anon, authenticated;
revoke all on function public.receipt_name_key(text)       from public, anon, authenticated;
revoke all on function public.receipt_scope(text, text)    from public, anon, authenticated;
revoke all on function public.product_identity_key(text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.normalize_ean(text)       to anon, authenticated;
grant execute on function public.receipt_name_key(text)    to anon, authenticated;
grant execute on function public.receipt_scope(text, text) to anon, authenticated;
grant execute on function public.product_identity_key(text, text, numeric, text) to anon, authenticated;

-- ── Товари ─────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id              uuid primary key default gen_random_uuid(),
  -- Рівно один тип: від нього залежить, яким рецептам пачка підходить.
  type_key        text not null check (type_key ~ '^[a-z][a-z0-9_]*$'),
  -- Назва — рівно те, що бачить людина. Бренд і жирність — підказки для
  -- пошуку й дублікатів; назву з них автоматично не складаємо.
  name            text not null check (char_length(btrim(name)) between 2 and 120),
  brand           text check (brand is null or char_length(btrim(brand)) between 1 and 60),
  fat_pct         numeric(4,1)  check (fat_pct is null or fat_pct between 0 and 100),
  -- Упаковка окремо від назви («· 900 мл»): з неї комора рахує, скільки лишилось.
  pack_amount     numeric(10,2) check (pack_amount is null or (pack_amount > 0 and pack_amount <= 100000)),
  pack_unit       text check (pack_unit is null or pack_unit in ('g','kg','ml','l','pcs')),
  grams_per_piece numeric(10,2) check (grams_per_piece is null or grams_per_piece > 0),
  -- КБЖВ на 100 г з етикетки; порожнє — беремо з типу.
  kcal            numeric(6,1) check (kcal    is null or kcal    between 0 and 900),
  protein         numeric(5,1) check (protein is null or protein between 0 and 100),
  fat             numeric(5,1) check (fat     is null or fat     between 0 and 100),
  carbs           numeric(5,1) check (carbs   is null or carbs   between 0 and 100),
  image_url       text check (image_url is null or image_url ~ '^https://'),
  source          text not null default 'user' check (source in ('user','off','receipt','migration')),
  -- «Прибрати картку» замість видалення: вандалізм чи помилку можна повернути.
  archived        boolean not null default false,
  -- Обʼєднаний дублікат (community-merge.sql): рядки комори й коди йдуть до переможця.
  merged_into     uuid references public.products (id),
  version         integer not null default 1,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null,
  updated_at      timestamptz not null default now(),
  search_key      text generated always as
    (lower(regexp_replace(btrim(name || ' ' || coalesce(brand, '')), '\s+', ' ', 'g'))) stored,
  identity_key    text generated always as
    (public.product_identity_key(name, brand, pack_amount, pack_unit)) stored,
  constraint products_pack_pair        check ((pack_amount is null) = (pack_unit is null)),
  constraint products_nutrition_whole  check (kcal is not null or (protein is null and fat is null and carbs is null)),
  constraint products_macros           check (coalesce(protein,0) + coalesce(fat,0) + coalesce(carbs,0) <= 105),
  constraint products_not_self_merged  check (merged_into is null or merged_into <> id)
);

-- Дублікат ніколи не тихий: друга така сама картка впирається сюди, і
-- save_product відповідає «Такий товар уже є: … Це він?».
create unique index if not exists products_identity_uniq on public.products (identity_key)
  where merged_into is null and not archived;
create index if not exists products_type_idx    on public.products (type_key) where merged_into is null and not archived;
create index if not exists products_search_trgm on public.products using gin (search_key public.gin_trgm_ops);

-- Запобіжник картки. Invoker: читає лише каталоги типів, відкриті всім.
create or replace function public.products_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    -- Видалення профілю обнуляє created_by/updated_by окремим UPDATE від «on delete
    -- set null». Це не правка: ні версії, ні автора назад — інакше видалення акаунта
    -- падало б на ключі. Лише вкладений виклик (дія ключа) і лише обнулення.
    -- search_key/identity_key у NEW до BEFORE-тригера ще не пораховані (null) — не порівнюємо.
    if pg_trigger_depth() > 1
       and to_jsonb(new) - array['created_by', 'updated_by', 'search_key', 'identity_key']
         = to_jsonb(old) - array['created_by', 'updated_by', 'search_key', 'identity_key']
       and (new.created_by is null or new.created_by = old.created_by)
       and (new.updated_by is null or new.updated_by is not distinct from old.updated_by) then
      return new;
    end if;
    new.id := old.id; new.created_by := old.created_by; new.created_at := old.created_at;
    new.version := old.version + 1;
    -- Обʼєднання міняє лише merge_products / unmerge_product (nyam.merge = on).
    if nullif(current_setting('nyam.merge', true), '') is distinct from 'on' then
      new.merged_into := old.merged_into;
    end if;
  else
    new.created_by := auth.uid();
    new.created_at := now();
    new.version := 1;
    new.merged_into := null;
    new.archived := false;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();

  -- Тип мусить існувати: одруківка чи вандальна правка інакше переписала б
  -- тип рядків комори в усіх, у кого цей товар (products_type_to_pantry, I4).
  if tg_op = 'INSERT' or new.type_key is distinct from old.type_key then
    if not exists (select 1 from public.builtin_ingredients b where b.key = new.type_key)
       and not exists (select 1 from public.custom_ingredients c where c.key = new.type_key) then
      raise exception 'Немає типу %', new.type_key using errcode = '23503';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists products_guard on public.products;
create trigger products_guard before insert or update on public.products
  for each row execute function public.products_guard();

-- ── Ідентифікатори: штрихкод або назва з чека → товар або тип ─────────────
create table if not exists public.product_identifiers (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('ean', 'receipt_name')),
  -- '' = глобально. receipt_name: 'm:<мережа>' або 's:<ключ продавця>', коли продавець відомий.
  scope       text not null default '' check (scope ~ '^(|m:[a-z0-9_]{2,24}|s:.{1,60})$'),
  raw         text not null check (char_length(raw) between 1 and 200),
  value       text not null,                          -- рахує тригер із raw; клієнту не віримо
  product_id  uuid references public.products (id),
  type_key    text check (type_key is null or type_key ~ '^[a-z][a-z0-9_]*$'),
  source      text not null default 'manual' check (source in ('scan','qr','photo','manual','migration')),
  merged_from uuid,                                   -- де був до обʼєднання (для unmerge_product)
  version     integer not null default 1,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint product_identifiers_target     check ((product_id is null) <> (type_key is null)),
  constraint product_identifiers_ean_global check (kind <> 'ean' or scope = ''),
  constraint product_identifiers_uniq       unique (kind, scope, value)
);
create index if not exists product_identifiers_product_idx on public.product_identifiers (product_id) where product_id is not null;
create index if not exists product_identifiers_value_idx   on public.product_identifiers (kind, value);

create or replace function public.product_identifiers_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    -- Як у products_guard: видалення профілю обнуляє created_by/updated_by окремим UPDATE від «on delete
    -- set null». Це не правка: ні версії, ні автора назад — інакше видалення акаунта
    -- падало б на ключі. Лише вкладений виклик (дія ключа) і лише обнулення.
    if pg_trigger_depth() > 1
       and to_jsonb(new) - 'created_by' - 'updated_by' = to_jsonb(old) - 'created_by' - 'updated_by'
       and (new.created_by is null or new.created_by = old.created_by)
       and (new.updated_by is null or new.updated_by is not distinct from old.updated_by) then
      return new;
    end if;
    -- Що це за код і де його бачили — незмінне; міняється лише, на що він вказує.
    new.id := old.id; new.kind := old.kind; new.scope := old.scope; new.raw := old.raw;
    new.created_by := old.created_by; new.created_at := old.created_at;
    new.version := old.version + 1;
  else
    new.version := 1;
    new.created_at := now();
    if nullif(current_setting('nyam.merge', true), '') is distinct from 'on' then
      new.merged_from := null;
    end if;
  end if;
  -- value завжди з raw: і клієнт не підсуне свій ключ, і нова версія ключа
  -- перераховується простим update без зміни raw.
  new.value := case new.kind when 'ean' then public.normalize_ean(new.raw) else public.receipt_name_key(new.raw) end;
  if new.value is null then
    raise exception 'Це не схоже на штрихкод чи назву з чека: %', left(new.raw, 60) using errcode = '22023';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();

  if new.product_id is not null and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id) then
    if not exists (select 1 from public.products p
                    where p.id = new.product_id and p.merged_into is null and not p.archived) then
      raise exception 'Цю картку прибрали або обʼєднали з іншою' using errcode = '23514';
    end if;
  end if;
  if new.type_key is not null and (tg_op = 'INSERT' or new.type_key is distinct from old.type_key) then
    if not exists (select 1 from public.builtin_ingredients b where b.key = new.type_key)
       and not exists (select 1 from public.custom_ingredients c where c.key = new.type_key) then
      raise exception 'Немає типу %', new.type_key using errcode = '23503';
    end if;
  end if;
  -- Перепривʼязка поза обʼєднанням — свідоме рішення людини: unmerge_product
  -- такий код назад не забирає.
  if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id
     and nullif(current_setting('nyam.merge', true), '') is distinct from 'on' then
    new.merged_from := null;
  end if;
  return new;
end $$;
drop trigger if exists product_identifiers_guard on public.product_identifiers;
create trigger product_identifiers_guard before insert or update on public.product_identifiers
  for each row execute function public.product_identifiers_guard();

-- ── Історія спільних правок ────────────────────────────────────────────────
create table if not exists public.community_changes (
  id            bigint generated always as identity primary key,
  table_name    text not null check (table_name in ('products','product_identifiers','custom_ingredients')),
  row_id        text not null,
  op            text not null check (op in ('insert','update','delete','merge','unmerge')),
  changed_by    uuid references public.profiles (id) on delete set null,
  changed_at    timestamptz not null default now(),
  before        jsonb,
  after         jsonb,
  reverted_from bigint references public.community_changes (id)
);
create index if not exists community_changes_row_idx  on public.community_changes (table_name, row_id, id desc);
create index if not exists community_changes_user_idx on public.community_changes (changed_by, changed_at desc);

-- tg_argv[0] — назва ключової колонки: 'id' | 'key'.
-- Без стелі змін усередині: тригер, що відмовляє, обривав би RPC посередині.
-- Стелю тримає community_budget на вході в кожну RPC.
create or replace function public.audit_community_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Автор лежить у changed_by; у знімках його не тримаємо (не зануляється при видаленні профілю).
  b jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) - 'created_by' - 'updated_by' end;
  a jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) - 'created_by' - 'updated_by' end;
  noise text[] := array['version','updated_at','search_key','identity_key'];
begin
  if tg_op = 'UPDATE' and (b - noise) = (a - noise) then return null; end if;   -- повтори без змін не пишемо
  -- nullif(…, ''): у пулі зʼєднань змінна після чужої транзакції — '', а не null.
  insert into public.community_changes (table_name, row_id, op, changed_by, before, after, reverted_from)
  values (tg_table_name, coalesce(a, b) ->> tg_argv[0],
          coalesce(nullif(current_setting('nyam.change_op', true), ''), lower(tg_op)),
          auth.uid(), b, a, nullif(current_setting('nyam.revert_of', true), '')::bigint);
  return null;
end $$;

drop trigger if exists products_audit on public.products;
create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit_community_change('id');
drop trigger if exists product_identifiers_audit on public.product_identifiers;
create trigger product_identifiers_audit after insert or update or delete on public.product_identifiers
  for each row execute function public.audit_community_change('id');
drop trigger if exists custom_ingredients_audit on public.custom_ingredients;
create trigger custom_ingredients_audit after insert or update or delete on public.custom_ingredients
  for each row execute function public.audit_community_change('key');

-- ── Внутрішні помічники ────────────────────────────────────────────────────

-- Стеля змін: 400 за 10 хвилин на людину. Чесному користувачеві не
-- дотягнутись і великим чеком (60 рядків), а вандала зупиняє за хвилину.
create or replace function public.community_budget(p_writes int)
returns void language plpgsql security definer set search_path = public as $$
declare used int;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  select count(*) into used from public.community_changes
   where changed_by = auth.uid() and changed_at > now() - interval '10 minutes';
  if used + greatest(coalesce(p_writes, 1), 0) > 400 then
    raise exception 'Забагато змін поспіль — спробуй за кілька хвилин'
      using errcode = 'P0001', hint = 'catalog_rate_limit';
  end if;
end $$;

-- Картка в тій формі, яку клієнту дозволено бачити (PRODUCT_SELECT): без
-- авторів, часу створення й службових ключів.
create or replace function public.product_client_json(p public.products)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'type_key', p.type_key, 'name', p.name, 'brand', p.brand, 'fat_pct', p.fat_pct,
    'pack_amount', p.pack_amount, 'pack_unit', p.pack_unit, 'grams_per_piece', p.grams_per_piece,
    'kcal', p.kcal, 'protein', p.protein, 'fat', p.fat, 'carbs', p.carbs, 'image_url', p.image_url,
    'source', p.source, 'archived', p.archived, 'merged_into', p.merged_into, 'version', p.version,
    'updated_at', p.updated_at)
$$;

-- Те саме для ідентифікатора (IDENTIFIER_SELECT).
create or replace function public.identifier_client_json(i public.product_identifiers)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'id', i.id, 'kind', i.kind, 'scope', i.scope, 'raw', i.raw, 'value', i.value,
    'product_id', i.product_id, 'type_key', i.type_key, 'source', i.source, 'version', i.version)
$$;

-- Застаріла версія чи рядка немає — дві різні відповіді людині.
create or replace function public.catalog_stale_or_missing(p_table text, p_id text)
returns void language plpgsql stable set search_path = public as $$
declare found_row boolean;
begin
  execute format('select exists (select 1 from public.%I where %I::text = $1)', p_table,
                 case p_table when 'custom_ingredients' then 'key' else 'id' end)
    into found_row using p_id;
  if found_row then
    raise exception 'Картку щойно змінили — онови й спробуй ще раз'
      using errcode = '40001', hint = 'catalog_conflict';
  end if;
  raise exception 'Такої картки немає' using errcode = 'P0002';
end $$;

revoke all on function public.community_budget(int)                          from public, anon, authenticated;
revoke all on function public.product_client_json(public.products)           from public, anon, authenticated;
revoke all on function public.identifier_client_json(public.product_identifiers) from public, anon, authenticated;
revoke all on function public.catalog_stale_or_missing(text, text)           from public, anon, authenticated;
-- Тригерні функції як RPC не викликаються, але права за замовчуванням їх відкривають.
revoke all on function public.products_guard()            from public, anon, authenticated;
revoke all on function public.product_identifiers_guard() from public, anon, authenticated;
revoke all on function public.audit_community_change()    from public, anon, authenticated;

-- ── Читання (invoker: бачать рівно те, що дозволяють grant-и й RLS) ───────

-- Що база знає про штрихкоди й назви одного чека — один запит на весь чек.
-- Порядок: область цього магазину → глобально → чужі області, лише якщо всі
-- вони одностайні (інакше «Молоко 900» з АТБ підмінило б сільпівське).
create or replace function public.resolve_identifiers(
  p_eans text[], p_names text[], p_seller text default null, p_chain text default null)
returns table (kind text, raw text, identifier_id uuid, scope text, product_id uuid, type_key text, version int)
language sql stable set search_path = public as $$
  with s as (select public.receipt_scope(p_seller, p_chain) as scope),
  wanted as (
    select 'ean'::text as kind, r as raw, public.normalize_ean(r) as value
      from unnest((coalesce(p_eans, '{}'))[1:200]) r
    union
    select 'receipt_name', r, public.receipt_name_key(r)
      from unnest((coalesce(p_names, '{}'))[1:200]) r
  ), hits as (
    select w.kind, w.raw, i.id, i.scope, coalesce(p.merged_into, i.product_id) as product_id, i.type_key, i.version,
           case when i.scope = s.scope then 0 when i.scope = '' then 1 else 2 end as rank
      from wanted w
      cross join s
      join public.product_identifiers i on i.kind = w.kind and i.value = w.value
      left join public.products p on p.id = i.product_id
     where w.value is not null and (i.product_id is null or not p.archived)
  ), agree as (
    select h.kind, h.raw, count(distinct coalesce(h.product_id::text, h.type_key)) as targets
      from hits h group by h.kind, h.raw
  )
  select distinct on (h.kind, h.raw) h.kind, h.raw, h.id, h.scope, h.product_id, h.type_key, h.version
    from hits h join agree a using (kind, raw)
   where h.rank < 2 or a.targets = 1          -- чужі області лише одностайні
   order by h.kind, h.raw, h.rank
$$;

-- Пошук карток для пікера й «Можливо, це вже є:». Індексовані умови —
-- like найдовшого слова або <% (обидві бере trigram GIN); like all по всіх
-- словах індекс не бере, тож він лише перевірка.
create or replace function public.search_products(p_query text, p_type_keys text[] default null, p_limit int default 20)
returns table (id uuid, type_key text, name text, brand text, fat_pct numeric, pack_amount numeric, pack_unit text,
               grams_per_piece numeric, kcal numeric, protein numeric, fat numeric, carbs numeric,
               image_url text, source text, archived boolean, merged_into uuid, version int, updated_at timestamptz)
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
           p.kcal, p.protein, p.fat, p.carbs, p.image_url, p.source, p.archived, p.merged_into, p.version, p.updated_at
      from public.products p
     where p.merged_into is null and not p.archived
       and (p_type_keys is null or p.type_key = any (p_type_keys))
       and (p.search_key like v_pats[1] or v_text <% p.search_key)          -- індексовані умови
       and (p.search_key like all (v_pats) or v_text <% p.search_key)       -- перевірка всіх слів
     order by (p.search_key like all (v_pats)) desc, word_similarity(v_text, p.search_key) desc, p.updated_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

revoke all on function public.resolve_identifiers(text[], text[], text, text) from public, anon, authenticated;
revoke all on function public.search_products(text, text[], int)             from public, anon, authenticated;
grant execute on function public.resolve_identifiers(text[], text[], text, text) to anon, authenticated;
grant execute on function public.search_products(text, text[], int)             to anon, authenticated;

-- ── Правки карток ──────────────────────────────────────────────────────────

-- Створити (p_id = null) або виправити картку. p_card читаємо лише за
-- білим списком ключів; «migration» — лише для SQL-файлів, не для клієнта.
create or replace function public.save_product(p_id uuid, p_expected_version int, p_card jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row   public.products;
  v_name  text;
  v_brand text;
  v_src   text;
  v_pack_amount numeric;
  v_pack_unit   text;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_card is null or jsonb_typeof(p_card) <> 'object' then
    raise exception 'Порожня картка' using errcode = '22023';
  end if;
  -- Без типу картка нікому не підходить. Не 23503 від запобіжника («такого
  -- типу вже немає» — людині порадили б оновити застосунок), а помилка форми.
  if nullif(btrim(coalesce(p_card->>'type_key', '')), '') is null then
    raise exception 'Обери тип товару' using errcode = '22023';
  end if;
  perform public.community_budget(1);

  v_name  := nullif(btrim(regexp_replace(coalesce(p_card->>'name', ''), '\s+', ' ', 'g')), '');
  v_brand := nullif(btrim(regexp_replace(coalesce(p_card->>'brand', ''), '\s+', ' ', 'g')), '');
  v_src   := case when p_card->>'source' in ('off', 'receipt') then p_card->>'source' else 'user' end;
  v_pack_amount := (p_card->>'pack_amount')::numeric;
  v_pack_unit   := nullif(p_card->>'pack_unit', '');

  if p_id is null then
    insert into public.products as t (type_key, name, brand, fat_pct, pack_amount, pack_unit, grams_per_piece,
                                      kcal, protein, fat, carbs, image_url, source)
    values (p_card->>'type_key', v_name, v_brand, (p_card->>'fat_pct')::numeric, v_pack_amount, v_pack_unit,
            (p_card->>'grams_per_piece')::numeric, (p_card->>'kcal')::numeric, (p_card->>'protein')::numeric,
            (p_card->>'fat')::numeric, (p_card->>'carbs')::numeric, nullif(p_card->>'image_url', ''), v_src)
    on conflict (identity_key) where merged_into is null and not archived do nothing
    returning * into v_row;
    if found then
      return jsonb_build_object('status', 'created', 'product', public.product_client_json(v_row));
    end if;
    -- Такий товар уже є — нічого не пишемо, людину спитають «Це він?».
    select * into v_row from public.products p
     where p.identity_key = public.product_identity_key(v_name, v_brand, v_pack_amount, v_pack_unit)
       and p.merged_into is null and not p.archived;
    return jsonb_build_object('status', 'duplicate', 'product', public.product_client_json(v_row));
  end if;

  if p_expected_version is null then
    raise exception 'Бракує номера версії картки' using errcode = '22023';
  end if;
  begin
    update public.products p
       set type_key = p_card->>'type_key', name = v_name, brand = v_brand,
           fat_pct = (p_card->>'fat_pct')::numeric, pack_amount = v_pack_amount, pack_unit = v_pack_unit,
           grams_per_piece = (p_card->>'grams_per_piece')::numeric, kcal = (p_card->>'kcal')::numeric,
           protein = (p_card->>'protein')::numeric, fat = (p_card->>'fat')::numeric,
           carbs = (p_card->>'carbs')::numeric, image_url = nullif(p_card->>'image_url', '')
           -- source не чіпаємо: правка людиною не робить OFF-картку «вигаданою».
     where p.id = p_id and p.version = p_expected_version and not p.archived and p.merged_into is null
    returning * into v_row;
  exception when unique_violation then
    -- Перейменування влучило в іншу картку — це дублікат, а не помилка.
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

-- «Прибрати картку для всіх» і «Повернути». Комори не чіпає: рядки лишаються
-- з product_id і назвою й далі читаються за id.
create or replace function public.set_product_archived(p_id uuid, p_expected_version int, p_archived boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.products;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_id is null or p_expected_version is null or p_archived is null then
    raise exception 'Бракує картки чи версії' using errcode = '22023';
  end if;
  perform public.community_budget(1);
  select * into v_row from public.products p where p.id = p_id and p.version = p_expected_version for update;
  if not found then perform public.catalog_stale_or_missing('products', p_id::text); end if;
  -- Вже так — версію не крутимо й історію не засмічуємо.
  if v_row.archived = p_archived then return public.product_client_json(v_row); end if;
  begin
    update public.products p set archived = p_archived where p.id = p_id returning * into v_row;
  exception when unique_violation then
    raise exception 'Така картка вже є — обʼєднай їх' using errcode = 'P0001', hint = 'duplicate';
  end;
  return public.product_client_json(v_row);
end $$;

-- ── Навчання кодів і назв ──────────────────────────────────────────────────

-- Вставити, якщо такого ще немає; чуже не переписує НІКОЛИ. Відповідь на
-- кожен рядок: inserted | same (уже вказує туди ж) | conflict (вказує на інше,
-- із версією для «Виправити для всіх») | skipped (only_if_unknown, а код
-- уже десь відомий) | invalid (ключ не рахується).
create or replace function public.teach_identifiers(p_items jsonb, p_seller text default null, p_chain text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_scope text := public.receipt_scope(p_seller, p_chain);
  v_out   jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_kind  text;
  v_raw   text;
  v_value text;
  v_pid   uuid;
  v_type  text;
  v_src   text;
  v_row_scope text;
  v_row   public.product_identifiers;
  v_status text;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Очікували список рядків' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 60 then
    raise exception 'Забагато рядків за раз' using errcode = '22023';
  end if;
  perform public.community_budget(jsonb_array_length(p_items));

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind := v_item->>'kind';
    v_raw  := v_item->>'raw';
    v_pid  := null;
    v_type := nullif(v_item->>'type_key', '');
    -- Обʼєднаний дописаний тип (community-merge.sql) у базі завжди записаний
    -- переможцем (тригер), тож і порівнюємо з канонічним ключем: клієнт, що ще
    -- тримає переможений own_*, інакше отримав би «conflict» проти того самого
    -- типу. Динамічно: до community-merge.sql функції ще немає.
    if v_type is not null and to_regprocedure('public.canonical_type_key(text)') is not null then
      execute 'select public.canonical_type_key($1)' into v_type using v_type;
    end if;
    v_status := null;
    v_row := null;
    v_value := case v_kind when 'ean' then public.normalize_ean(v_raw)
                           when 'receipt_name' then public.receipt_name_key(v_raw) end;
    v_row_scope := case v_kind when 'ean' then '' else v_scope end;

    if jsonb_typeof(v_item) <> 'object' or v_value is null or char_length(v_raw) > 200
       or ((v_item->>'product_id') is null) = (v_type is null)
       or (v_item->>'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_status := 'invalid';
    end if;

    if v_status is null and (v_item->>'product_id') is not null then
      -- Кеш клієнта міг тримати переможену картку — вчимо на переможця.
      select coalesce(p.merged_into, p.id) into v_pid from public.products p where p.id = (v_item->>'product_id')::uuid;
      if v_pid is null then raise exception 'Такої картки немає' using errcode = 'P0002'; end if;
      -- Картку тим часом прибрали: цей рядок не вчимо, але решту чека — так.
      -- Запобіжник (23514) обірвав би всю пачку через один рядок.
      if exists (select 1 from public.products p where p.id = v_pid and p.archived) then
        v_status := 'invalid';
      end if;
    end if;

    if v_status is null and v_item->'only_if_unknown' = 'true'::jsonb
       and exists (select 1 from public.product_identifiers i where i.kind = v_kind and i.value = v_value) then
      v_status := 'skipped';
    end if;

    if v_status is null then
      v_src := case when v_item->>'source' in ('scan', 'qr', 'photo', 'manual') then v_item->>'source' else 'manual' end;
      insert into public.product_identifiers as t (kind, scope, raw, product_id, type_key, source, created_by)
      values (v_kind, v_row_scope, v_raw, v_pid, v_type, v_src, auth.uid())
      on conflict (kind, scope, value) do nothing
      returning * into v_row;
      if found then
        v_status := 'inserted';
      else
        select * into v_row from public.product_identifiers i
         where i.kind = v_kind and i.scope = v_row_scope and i.value = v_value;
        v_status := case when v_row.product_id is not distinct from v_pid and v_row.type_key is not distinct from v_type
                         then 'same' else 'conflict' end;
      end if;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'kind', v_kind, 'raw', v_raw, 'status', v_status, 'identifier_id', v_row.id,
      'scope', coalesce(v_row.scope, case when v_status in ('invalid', 'skipped') then null else v_row_scope end),
      'product_id', v_row.product_id, 'type_key', v_row.type_key, 'version', v_row.version));
  end loop;
  return v_out;
end $$;

-- «Виправити для всіх» і автоматичне уточнення тип → товар цього типу.
create or replace function public.reassign_identifier(p_id uuid, p_expected_version int, p_product_id uuid, p_type_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.product_identifiers; v_pid uuid;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_id is null or p_expected_version is null or (p_product_id is null) = (nullif(p_type_key, '') is null) then
    raise exception 'Код має вказувати або на товар, або на тип' using errcode = '22023';
  end if;
  perform public.community_budget(1);
  if p_product_id is not null then
    select coalesce(p.merged_into, p.id) into v_pid from public.products p where p.id = p_product_id;
    if v_pid is null then raise exception 'Такої картки немає' using errcode = 'P0002'; end if;
  end if;
  update public.product_identifiers i
     set product_id = v_pid, type_key = nullif(p_type_key, '')
   where i.id = p_id and i.version = p_expected_version
  returning * into v_row;
  if not found then perform public.catalog_stale_or_missing('product_identifiers', p_id::text); end if;
  return public.identifier_client_json(v_row);
end $$;

-- «Прибрати цей код». Пишеться в історію — його можна повернути.
create or replace function public.delete_identifier(p_id uuid, p_expected_version int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_id is null or p_expected_version is null then
    raise exception 'Бракує коду чи версії' using errcode = '22023';
  end if;
  perform public.community_budget(1);
  delete from public.product_identifiers i where i.id = p_id and i.version = p_expected_version;
  if not found then perform public.catalog_stale_or_missing('product_identifiers', p_id::text); end if;
end $$;

-- ── Історія й повернення версій ────────────────────────────────────────────

-- Хто й коли правив. Для кодів і для створення картки автор і точний час
-- приховані: людина + час + код із магазину (чи нова картка) видали б, де й
-- коли вона купувала. Пізніші правки картки показують імʼя — це вікі.
create or replace function public.community_history(p_table text, p_row_id text, p_limit int default 50)
returns table (id bigint, op text, changed_at timestamptz, actor_name text, before jsonb, after jsonb, reverted_from bigint)
language plpgsql stable security definer set search_path = public as $$
declare hidden_cols text[] := array['created_at', 'updated_at', 'merged_from', 'search_key', 'identity_key'];
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_table is null or p_table not in ('products', 'product_identifiers', 'custom_ingredients') then
    raise exception 'Історії для «%» немає', coalesce(p_table, '') using errcode = '22023';
  end if;
  return query
    select c.id, c.op,
           case when c.table_name = 'product_identifiers' or (c.table_name = 'products' and c.op = 'insert')
                then date_trunc('day', c.changed_at) else c.changed_at end,
           case when c.table_name = 'product_identifiers' or (c.table_name = 'products' and c.op = 'insert')
                then null else pr.name end,
           c.before - hidden_cols, c.after - hidden_cols, c.reverted_from
      from public.community_changes c
      left join public.profiles pr on pr.id = c.changed_by
     where c.table_name = p_table and c.row_id = p_row_id
     order by c.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- «Повернути цю версію»: рядок стає рівним after цього запису (лише
-- колонки з білого списку). merged_into так не повертається — для цього
-- unmerge_product.
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
      -- Код видалили — повертаємо той самий рядок. created_by порожній: хто
      -- повернув, той не навчив його першим.
      begin
        insert into public.product_identifiers (id, kind, scope, raw, product_id, type_key, source, created_by)
        values (i.id, i.kind, i.scope, i.raw, v_pid, case when v_pid is null then i.type_key end, i.source, null);
      exception when unique_violation then
        raise exception 'Цей код уже привʼязаний до іншого' using errcode = '23505';
      end;
    end if;

  elsif v_change.table_name = 'custom_ingredients' then
    c := jsonb_populate_record(null::public.custom_ingredients, v_change.after);
    -- Запобіжник дерева перевірить батька заново: з того часу дерево могло змінитись.
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

-- ── Дописані типи: правка для всіх — лише так, з історією ─────────────────
-- Створення лишається прямим insert (так пишуть і старі клієнти).
create or replace function public.save_custom_ingredient(p_key text, p_expected_version int, p_def jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.custom_ingredients;
begin
  if auth.uid() is null then raise exception 'Треба увійти в акаунт' using errcode = '28000'; end if;
  if p_key is null or p_key !~ '^own_' or p_expected_version is null
     or p_def is null or jsonb_typeof(p_def) <> 'object' then
    raise exception 'Правити можна лише дописаний тип' using errcode = '22023';
  end if;
  perform public.community_budget(1);
  update public.custom_ingredients t
     set label           = btrim(coalesce(p_def->>'label', '')),
         emoji           = coalesce(nullif(p_def->>'emoji', ''), t.emoji),
         cat             = coalesce(nullif(p_def->>'cat', ''), t.cat),
         aliases         = case when jsonb_typeof(p_def->'aliases') = 'array'
                                then array(select jsonb_array_elements_text(p_def->'aliases')) else '{}' end,
         staple          = coalesce((p_def->>'staple')::boolean, false),
         grams_per_piece = (p_def->>'grams_per_piece')::numeric,
         grams_per_cup   = (p_def->>'grams_per_cup')::numeric,
         default_unit    = coalesce(nullif(p_def->>'default_unit', ''), t.default_unit),
         kcal            = (p_def->>'kcal')::numeric,
         protein         = (p_def->>'protein')::numeric,
         fat             = (p_def->>'fat')::numeric,
         carbs           = (p_def->>'carbs')::numeric,
         parent_key      = nullif(p_def->>'parent_key', '')
   where t.key = p_key and t.version = p_expected_version
  returning * into v_row;
  if not found then perform public.catalog_stale_or_missing('custom_ingredients', p_key); end if;
  return to_jsonb(v_row) - 'created_by' - 'updated_by' - 'created_at' - 'updated_at';
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.save_product(uuid, int, jsonb)',
    'public.set_product_archived(uuid, int, boolean)',
    'public.teach_identifiers(jsonb, text, text)',
    'public.reassign_identifier(uuid, int, uuid, text)',
    'public.delete_identifier(uuid, int)',
    'public.community_history(text, text, int)',
    'public.restore_community_version(bigint, int)',
    'public.save_custom_ingredient(text, int, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ── Права й RLS ────────────────────────────────────────────────────────────
alter table public.products            enable row level security;
alter table public.product_identifiers enable row level security;
alter table public.community_changes   enable row level security;

-- products: читають усі — але без авторів і часу створення. Пишуть лише RPC.
-- Через grant на колонки клієнт НІКОЛИ не робить select * (PRODUCT_SELECT).
revoke all on public.products from anon, authenticated;
grant select (id, type_key, name, brand, fat_pct, pack_amount, pack_unit, grams_per_piece,
              kcal, protein, fat, carbs, image_url, source, archived, merged_into, version, updated_at, search_key)
  on public.products to anon, authenticated;
drop policy if exists "products readable" on public.products;
create policy "products readable" on public.products for select using (true);

-- product_identifiers: без авторів і часу (приватність покупок).
revoke all on public.product_identifiers from anon, authenticated;
grant select (id, kind, scope, raw, value, product_id, type_key, source, version)
  on public.product_identifiers to anon, authenticated;
drop policy if exists "identifiers readable" on public.product_identifiers;
create policy "identifiers readable" on public.product_identifiers for select using (true);

-- community_changes: лише через community_history (сирі — службовому ключу, для модерації).
revoke all on public.community_changes from anon, authenticated;
revoke usage, select, update on sequence public.community_changes_id_seq from anon, authenticated;

-- custom_ingredients: вставка лишається прямою (так пишуть старі клієнти),
-- правка — лише save_custom_ingredient. Політика «update own» з family.sql без
-- цього права більше нічого не дозволяє.
revoke update on public.custom_ingredients from anon, authenticated;

-- ── Перенесення довідника штрихкодів ───────────────────────────────────────
-- barcode_cache заморожено: новий код його не читає й не пише. Коди з
-- відомим типом стають «EAN → тип». Рядки, яким контрактний крок уже не
-- знадобиться, лишаються як є — старі клієнти ще їх читають.
-- Рядки з назвою, яка не «Товар <код>» (у живій базі таких немає), — для ручного перенесення:
--   select * from public.barcode_cache where name !~ '^Товар \d+$';
-- Повторний запуск (і контрактний крок) не воскрешає код, який хтось свідомо
-- прибрав (delete_identifier пише «delete» в історію): інакше помилкова
-- привʼязка повернулась би для всіх без жодного сліду в історії.
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

notify pgrst, 'reload schema';
