-- Кількість продукту в коморі: число + одиниця виміру.
--
-- Навіщо: раніше комора знала лише «що є», але не «скільки». Вільний текст
-- qty для цього не годився — його не порівняти з потребою рецепта й не
-- скласти у список покупок. Тепер число і одиниця лежать окремими полями,
-- як в інгредієнтах рецепта.
--
-- Виконувати лише тим, у кого база вже створена за старою schema.sql:
-- у новій ці колонки вже є. Скрипт безпечно запускати повторно.

alter table public.pantry_items
  add column if not exists amount numeric(10, 2),
  add column if not exists unit   text;

comment on column public.pantry_items.amount is
  'Скільки продукту вдома; null — кількість не вказано.';
comment on column public.pantry_items.unit is
  'Одиниця виміру: g, kg, ml, l, pcs, tbsp, tsp, cup, bunch, handful, pinch.';
