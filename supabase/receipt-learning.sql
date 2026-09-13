-- ============================================================================
--  Ням — «Схоже на: …» для назв із чека, яких база ще не знає дослівно.
--
--  Виконувати в Supabase → SQL Editor після products.sql. Скрипт
--  ідемпотентний. Код, що кличе similar_receipt_names, деплоїти ПІСЛЯ.
--  Свіжа база з schema.sql це вже має — там повторний запуск нічого не змінює.
--
--  Навіщо. Фото чека розпізнає ту саму касову назву щоразу трохи інакше:
--  «МОЛОКОБЕЗЛАКТГАЛИЧИНА» сьогодні, «МОЛОКОБЕЗЛАКТГАЛЧИНА» завтра. Точний
--  ключ (receipt_name_key) такої різниці не прощає, і знайомий товар
--  лишався б «невідомим». Тут — близькі назви, але лише як ПІДКАЗКА: людина
--  підтверджує «Так», і ніщо не стає розпізнаним само.
--
--  Цифри мусять збігтися повністю: 2,5% і 3,2%, 900 г і 950 г — різні товари,
--  хоч літерами назви майже однакові. Лише для увійшлих: сирі назви з чеків
--  разом з областю магазину гостю ні до чого.
-- ============================================================================

do $$
begin
  if to_regclass('public.product_identifiers') is null
     or to_regprocedure('public.receipt_scope(text, text)') is null then
    raise exception 'Спершу виконай supabase/products.sql' using errcode = '55000';
  end if;
end $$;

-- Лише назви з чека: штрихкоди шукаються точно.
create index if not exists product_identifiers_name_trgm on public.product_identifiers
  using gin (value public.gin_trgm_ops) where kind = 'receipt_name';

create or replace function public.similar_receipt_names(
  p_names text[], p_seller text default null, p_chain text default null)
returns table (raw text, identifier_id uuid, value text, similarity real, product_id uuid)
language sql stable set search_path = public as $$
  with s as (select public.receipt_scope(p_seller, p_chain) as scope)
  select distinct on (q.raw) q.raw, i.id, i.value, similarity(i.value, q.k), coalesce(p.merged_into, i.product_id)
    from (select r as raw, public.receipt_name_key(r) as k from unnest((coalesce(p_names, '{}'))[1:40]) r) q
    cross join s
    join public.product_identifiers i on i.kind = 'receipt_name' and i.value % q.k
    join public.products p on p.id = i.product_id and not p.archived
   where q.k is not null
     and similarity(i.value, q.k) >= 0.8
     -- Цифри мають збігтися повністю: 2.5% і 3.2%, 900 і 950 — різні товари.
     and regexp_replace(i.value, '[^0-9.%]', '', 'g') = regexp_replace(q.k, '[^0-9.%]', '', 'g')
   order by q.raw, (i.scope = s.scope) desc, similarity(i.value, q.k) desc
$$;

revoke all on function public.similar_receipt_names(text[], text, text) from public, anon, authenticated;
grant execute on function public.similar_receipt_names(text[], text, text) to authenticated;

notify pgrst, 'reload schema';
