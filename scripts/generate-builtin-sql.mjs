/**
 * Генерує supabase/builtin-ingredients.sql — дзеркало вбудованого каталогу в базі.
 *
 *   node scripts/generate-builtin-sql.mjs          переписати файл
 *   node scripts/generate-builtin-sql.mjs --check  лише звірити (1 — файл застарів)
 *
 * Навіщо дзеркало. Вбудовані типи живуть у коді (src/data/ingredients.ts), а
 * база мусить перевіряти посилання на них: батька дописаного типу, глибину
 * ланцюжка «різновид різновиду», а далі — тип товару й штрихкоду. Без таблиці
 * «moloko» для бази — просто рядок, і одрук «molokoo» лягав би назавжди.
 *
 * Той самий текст рядків npm run db:seed-sql дописує в setup.sql, а
 * check:matching звіряє файл із цим генератором: застарілий файл — червоний.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export const BUILTIN_SQL_PATH = path.join(root, "supabase/builtin-ingredients.sql");

const q = (value) => (value == null ? "null" : `'${String(value).replace(/'/g, "''")}'`);

/**
 * Один insert на весь каталог. Порядок рядків неважливий: перевірка
 * зовнішнього ключа на саму таблицю в багаторядковому insert іде вже після
 * всіх рядків. Рядки не видаляються ніколи — ключі вбудованих лише додаються
 * (scripts/builtin-keys.txt), бо на них посилаються рецепти й комори.
 */
export function builtinRowsSql(ingredients) {
  const rows = ingredients.map((def) => `  (${q(def.key)}, ${q(def.parent ?? null)})`);
  return [
    "insert into public.builtin_ingredients (key, parent_key) values",
    `${rows.join(",\n")}`,
    "on conflict (key) do update set parent_key = excluded.parent_key",
    "  where builtin_ingredients.parent_key is distinct from excluded.parent_key;",
  ].join("\n");
}

/*
 * Визначення таблиці — дослівно те саме, що в schema.sql: обидва файли
 * безпечно накладати один на одного, і повторний запуск будь-якого з них не
 * змінює ні схеми, ні прав (це перевіряє стенд sqltest).
 */
export const BUILTIN_TABLE_SQL = `create table if not exists public.builtin_ingredients (
  key        text primary key check (key ~ '^[a-z][a-z0-9_]*$' and key !~ '^own_'),
  parent_key text references public.builtin_ingredients (key)
);

alter table public.builtin_ingredients enable row level security;
revoke all on public.builtin_ingredients from anon, authenticated;
grant select on public.builtin_ingredients to anon, authenticated;
drop policy if exists "builtin ingredients readable" on public.builtin_ingredients;
create policy "builtin ingredients readable" on public.builtin_ingredients
  for select using (true);`;

/*
 * Після заливки — родовід кожного типу: не глибше шести рівнів (MAX_TYPE_DEPTH)
 * і без кола. Запобіжник custom_ingredients перевіряє це лише для рядка, який
 * правлять; а тут переносять вбудований тип, під яким уже можуть висіти
 * дописані. Помилка відкочує весь файл — у базі лишається попередній каталог.
 * Колонки parent_key у дописаних ще немає, поки на стару базу не накладено
 * ingredient-parents.sql (виробничий порядок: цей файл перший), — тоді лише
 * вбудовані. plpgsql готує запит при першому виконанні, тож гілка з колонкою,
 * якої немає, не заважає.
 */
export const BUILTIN_DEPTH_CHECK_SQL = `do $$
declare deepest text;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'custom_ingredients'
                and column_name = 'parent_key') then
    with recursive up (key, cur, d) as (
      select key, parent_key, 0 from public.builtin_ingredients
      union all
      select key, parent_key, 0 from public.custom_ingredients
      union all
      select u.key, coalesce(c.parent_key, b.parent_key), u.d + 1
        from up u
        left join public.custom_ingredients c on c.key = u.cur
        left join public.builtin_ingredients b on b.key = u.cur
       where u.cur is not null and u.d < 6
    )
    select key into deepest from up where d = 6 and cur is not null limit 1;
  else
    with recursive up (key, cur, d) as (
      select key, parent_key, 0 from public.builtin_ingredients
      union all
      select u.key, b.parent_key, u.d + 1
        from up u join public.builtin_ingredients b on b.key = u.cur
       where u.d < 6
    )
    select key into deepest from up where d = 6 and cur is not null limit 1;
  end if;
  if deepest is not null then
    raise exception 'Задовгий ланцюжок різновидів: %', deepest using errcode = '23514';
  end if;
end $$;`;

export function renderBuiltinSql(ingredients) {
  const parented = ingredients.filter((def) => def.parent).length;
  return [
    "-- ============================================================================",
    `--  Ням — вбудовані типи продуктів у базі: ${ingredients.length} ключів, ${parented} із батьком.`,
    "--",
    "--  ЗГЕНЕРОВАНО: node scripts/generate-builtin-sql.mjs із src/data/ingredients.ts.",
    "--  Не редагувати вручну.",
    "--",
    "--  Виконувати в Supabase → SQL Editor після schema.sql. Скрипт ідемпотентний.",
    "--  Кожен деплой, що додає вбудовані продукти чи міняє їхніх батьків, —",
    "--  перезапустити цей файл ДО деплою коду: інакше новий тип не пройде",
    "--  перевірку батька дописаного типу (помилка 23503 «Немає типу …»).",
    "-- ============================================================================",
    "",
    BUILTIN_TABLE_SQL,
    "",
    builtinRowsSql(ingredients),
    "",
    BUILTIN_DEPTH_CHECK_SQL,
    "",
    "notify pgrst, 'reload schema';",
    "",
  ].join("\n");
}

export async function loadIngredients() {
  const jiti = createJiti(import.meta.url, {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  const { INGREDIENTS } = await jiti.import(path.join(root, "src/data/ingredients.ts"));
  return INGREDIENTS;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const sql = renderBuiltinSql(await loadIngredients());
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(BUILTIN_SQL_PATH, "utf8").replace(/\r\n/g, "\n");
    } catch {
      /* файлу немає — теж застарілий */
    }
    if (current !== sql) {
      console.error("✗ supabase/builtin-ingredients.sql застарів — npm run db:seed-sql");
      process.exit(1);
    }
    console.log("✓ supabase/builtin-ingredients.sql збігається з каталогом");
  } else {
    writeFileSync(BUILTIN_SQL_PATH, sql, "utf8");
    console.log("✓ supabase/builtin-ingredients.sql — дзеркало вбудованого каталогу");
  }
}
