-- Частина прийому їжі: гарнір, основна страва, суп, салат, напій…
--
-- Навіщо: рецепт не завжди є цілим обідом. Без цього поля застосунок не міг
-- ані відфільтрувати самі гарніри, ані підказати, що до чого подавати.
--
-- ВАЖЛИВО: вʼюху треба перестворити. Postgres розгортає `select r.*` у перелік
-- колонок під час створення вʼюхи, тож нової колонки вона сама не побачить —
-- а стрічка читається саме через неї.
--
-- Виконувати лише тим, у кого база вже створена за старою schema.sql.
-- Скрипт безпечно запускати повторно.

alter table public.recipes
  add column if not exists course text;

comment on column public.recipes.course is
  'whole | main | side | soup | salad | snack | sauce | dessert | drink; null — виводиться застосунком.';

create or replace view public.recipes_with_stats
with (security_invoker = on) as
select
  r.*,
  st.likes,
  st.saves,
  st.cooks,
  st.rating_sum,
  st.rating_count
from public.recipes r
join public.recipe_stats st on st.recipe_id = r.id;

notify pgrst, 'reload schema';
