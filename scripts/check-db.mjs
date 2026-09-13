/**
 * Перевіряє, чи готова база: чи валідні ключі, чи накатана схема,
 * чи залиті демо-дані.
 *
 *   npm run db:check
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createJiti } from "jiti";

function loadEnv() {
  const merged = {};
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.includes("=") || line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      merged[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return merged;
}

const env = loadEnv();
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL || env.PROJECT_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

if (!URL_ || !KEY) {
  console.error("✗ Немає ключів. Заповни .env.local за зразком .env.example");
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

/**
 * POST у PostgREST — так ходять RPC. Повертає статус, код помилки й тіло:
 * «функції немає» (PGRST202) і «закрито» (401/42501) треба розрізняти.
 */
async function post(path, body) {
  try {
    const res = await fetch(`${URL_}/rest/v1/${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* не JSON — лишаємо текст */
    }
    return { ok: res.ok, status: res.status, json, code: json?.code, body: text.slice(0, 160) };
  } catch (error) {
    return { ok: false, status: 0, json: null, code: undefined, body: error.message };
  }
}

async function get(path) {
  try {
    const res = await fetch(`${URL_}/rest/v1/${path}`, {
      headers: { ...headers, Prefer: "count=exact" },
    });
    return {
      ok: res.ok,
      status: res.status,
      count: res.headers.get("content-range")?.split("/")[1],
      body: res.ok ? null : (await res.text()).slice(0, 160),
    };
  } catch (error) {
    return { ok: false, status: 0, body: error.message };
  }
}

console.log(`База: ${new URL(URL_).host}\n`);

const auth = await fetch(`${URL_}/auth/v1/settings`, { headers })
  .then((r) => r.json())
  .catch(() => null);

if (!auth) {
  console.error("✗ Сервер не відповідає — перевір URL і ключ.");
  process.exit(1);
}
console.log("✓ Ключі валідні");
console.log(
  `  вхід через Google: ${auth.external?.google ? "увімкнено" : "ВИМКНЕНО — увійти буде неможливо"}`,
);

const checks = [
  ["profiles", "profiles?select=id"],
  ["recipes", "recipes?select=id"],
  ["recipes_with_stats", "recipes_with_stats?select=id"],
  ["profiles_with_counts", "profiles_with_counts?select=id"],
  ["likes", "likes?select=user_id"],
  ["pantry_items", "pantry_items?select=user_id"],
  ["plan_slots", "plan_slots?select=user_id"],
  ["custom_ingredients", "custom_ingredients?select=key"],
  // Дзеркало вбудованого каталогу — supabase/builtin-ingredients.sql.
  ["builtin_ingredients", "builtin_ingredients?select=key"],
  ["shopping_items", "shopping_items?select=id"],
  // Спільний каталог товарів — supabase/products.sql. Лише окремі колонки:
  // `select *` з products закритий grant-ом на колонки (автори й час створення).
  ["products", "products?select=id"],
  ["product_identifiers", "product_identifiers?select=id"],
];

/** Що виконати, якщо бракує саме цих обʼєктів. */
const FIX_FOR = {
  builtin_ingredients: "supabase/builtin-ingredients.sql, потім supabase/ingredient-parents.sql",
  products: "supabase/products.sql",
  product_identifiers: "supabase/products.sql",
};

console.log("\nТаблиці та вʼюхи:");
const missing = [];
for (const [name, path] of checks) {
  const r = await get(`${path}&limit=1`);
  if (r.ok) {
    console.log(`  ✓ ${name.padEnd(22)} рядків: ${r.count ?? "?"}`);
  } else {
    missing.push(name);
    console.log(`  ✗ ${name.padEnd(22)} ${r.status} ${r.body ?? ""}`);
  }
}

if (missing.length) {
  // Бракує лише пізніших частин (дзеркало каталогу, товари) — схема на місці, треба дописати їх.
  const fixes = [...new Set(missing.map((name) => FIX_FOR[name]))];
  console.log(
    fixes.every(Boolean)
      ? `\n→ Виконай ${fixes.join("; ")}.`
      : "\n→ Виконай supabase/schema.sql у Supabase SQL Editor.",
  );
  process.exit(1);
}

/*
 * Кожен список колонок із api.ts має існувати в базі.
 *
 * Перевірка зʼявилась після реального збою: у комору додали amount і unit,
 * запис їх зберігав, а select лишився старим — і кількість, яку щойно ввели,
 * зникала при першому ж перечитуванні. Помилку такого роду не бачать ані
 * типи, ані збірка: рядок із колонками — це просто текст.
 */
const source = readFileSync("src/lib/supabase/api.ts", "utf8");
const selects = [];
for (const m of source.matchAll(/\.from\("([a-z_]+)"\)/g)) {
  const rest = source.slice(m.index + m[0].length);
  const nextFrom = rest.search(/\.from\("/);
  const scope = nextFrom === -1 ? rest : rest.slice(0, nextFrom);
  const select = scope.match(/\.select\(\s*"([^"]+)"/);
  if (select) selects.push([m[1], select[1].replace(/\s+/g, "")]);
}

// Комора збирає свій список колонок із типу рядка, тож у коді немає літерала,
// який можна прочитати регуляркою. Беремо саму константу.
const jiti = createJiti(import.meta.url, {
  alias: { "@": resolve("src") },
  interopDefault: true,
});
const { PANTRY_SELECT, RECIPE_SELECT, CUSTOM_INGREDIENT_SELECT, SHOPPING_SELECT } = await jiti.import(
  resolve("src/lib/supabase/api.ts"),
);
const { PRODUCT_SELECT, IDENTIFIER_SELECT } = await jiti.import(resolve("src/lib/supabase/products-api.ts"));
// Комора по товару: id, user_id, product_id — pantry-products.sql; receipt_name, updated_at — pantry-receipt-name.sql.
selects.push(["pantry_items", PANTRY_SELECT]);
// Дописані типи: parent_key і version — ingredient-parents.sql; merged_into — community-merge.sql.
selects.push(["custom_ingredients", CUSTOM_INGREDIENT_SELECT]);
selects.push(["shopping_items", SHOPPING_SELECT]);
// Картки й ідентифікатори: рівно ті колонки, на які є grant (A5). Зайва — 42501, забута в grant — теж.
selects.push(["products", PRODUCT_SELECT]);
selects.push(["product_identifiers", IDENTIFIER_SELECT]);
// Рецепти так само: саме тут загубився course. Стрічка й власні читаються
// через вʼюху, тож перевіряємо обидві — вʼюху після нової колонки треба
// перестворювати (див. supabase/recipe-course.sql).
selects.push(["recipes_with_stats", RECIPE_SELECT]);

/*
 * Будильник готування з сервера — необовʼязковий: без таблиці таймер просто
 * дзвонить лише у відкритому застосунку. Тому попереджаємо, а не падаємо — і
 * колонки таблиці, якої ще немає, не рахуємо розбіжністю зі схемою. А от якщо
 * таблиця є, її колонки перевіряються так само суворо, як решта.
 * Розклад і секрети Vault ключем anon не перевірити — див. supabase/timer-push.sql.
 */
const timers = await get("timer_pushes?select=id,user_id,fire_at,title,body,url&limit=0");

console.log("\nКолонки, які запитує код:");
let broken = 0;
for (const [table, columns] of selects) {
  if (table === "timer_pushes" && !timers.ok) {
    console.log(`  · ${table.padEnd(22)} таблиці ще немає — див. нижче`);
    continue;
  }
  const r = await get(`${table}?select=${encodeURIComponent(columns)}&limit=0`);
  if (r.ok) {
    console.log(`  ✓ ${table.padEnd(22)} ${columns}`);
  } else {
    broken++;
    console.log(`  ✗ ${table.padEnd(22)} ${r.body ?? r.status}`);
  }
}

if (broken) {
  console.log(
    "\n→ Список колонок у api.ts / products-api.ts розійшовся зі схемою бази." +
      "\n  Порядок (як у README): builtin-ingredients.sql → ingredient-parents.sql → products.sql →" +
      " pantry-receipt-name.sql → pantry-products.sql → receipt-learning.sql → community-merge.sql.",
  );
  process.exit(1);
}

/*
 * Функції каталогу (A5). Чисті нормалізатори й читання відкриті навмисно — їх
 * і перевіряємо значенням. Решта мусить існувати, але бути закритою для anon:
 * 401/42501 — «є й закрито»; PGRST202 — функції немає (або не ті аргументи),
 * PGRST205 — таблиці немає; 200 — відкрито тим, кому не можна.
 */
console.log("\nФункції спільного каталогу:");
let rpcBroken = 0;
const expectValue = async (label, fn, body, expected) => {
  const r = await post(`rpc/${fn}`, body);
  if (r.ok && JSON.stringify(r.json) === JSON.stringify(expected)) {
    console.log(`  ✓ ${label}`);
  } else {
    rpcBroken++;
    console.log(`  ✗ ${label}: ${r.status} ${r.code ?? ""} ${r.ok ? JSON.stringify(r.json) : r.body}`);
  }
};
const expectOpen = async (fn, body) => {
  const r = await post(`rpc/${fn}`, body);
  if (r.ok) console.log(`  ✓ ${fn.padEnd(26)} відповідає`);
  else {
    rpcBroken++;
    console.log(`  ✗ ${fn.padEnd(26)} ${r.status} ${r.code ?? ""} ${r.body}`);
  }
};
const isClosed = (r) => r.status === 401 || r.status === 403 || r.code === "42501";
const expectClosed = async (label, request) => {
  const r = await request();
  if (isClosed(r)) console.log(`  ✓ ${label.padEnd(26)} існує й закрито`);
  else {
    rpcBroken++;
    const why = r.code === "PGRST202" || r.code === "PGRST205" ? "немає в базі" : r.ok ? "ВІДКРИТО для anon" : "";
    console.log(`  ✗ ${label.padEnd(26)} ${r.status} ${r.code ?? ""} ${why} ${r.ok ? "" : r.body}`);
  }
};

await expectValue("receipt_name_key(МолокГалБезл900)", "receipt_name_key", { raw: "МолокГалБезл900" }, "молокгалбезл900");
await expectValue("normalize_ean(4820000000000) = null", "normalize_ean", { raw: "4820000000000" }, null);
await expectValue("normalize_ean(4823096413518)", "normalize_ean", { raw: "4823096413518" }, "4823096413518");
await expectOpen("resolve_identifiers", { p_eans: [], p_names: [] });
await expectOpen("search_products", { p_query: "мо" });

const NIL = "00000000-0000-4000-8000-000000000000";
await expectClosed("community_changes", async () => {
  const r = await get("community_changes?select=id&limit=1");
  return { ...r, code: /42501/.test(r.body ?? "") ? "42501" : /PGRST205/.test(r.body ?? "") ? "PGRST205" : undefined };
});
// Памʼять обʼєднань типів тримає id чужих рядків комори й списку — клієнтам закрита цілком.
await expectClosed("custom_ingredient_merges", async () => {
  const r = await get("custom_ingredient_merges?select=id&limit=1");
  return { ...r, code: /42501/.test(r.body ?? "") ? "42501" : /PGRST205/.test(r.body ?? "") ? "PGRST205" : undefined };
});
for (const [fn, body] of [
  ["community_budget", { p_writes: 1 }],
  ["save_product", { p_id: null, p_expected_version: null, p_card: {} }],
  ["set_product_archived", { p_id: NIL, p_expected_version: 1, p_archived: true }],
  ["teach_identifiers", { p_items: [], p_seller: null, p_chain: null }],
  ["reassign_identifier", { p_id: NIL, p_expected_version: 1, p_product_id: null, p_type_key: "moloko" }],
  ["delete_identifier", { p_id: NIL, p_expected_version: 1 }],
  ["community_history", { p_table: "products", p_row_id: NIL, p_limit: 1 }],
  ["restore_community_version", { p_change_id: 1, p_expected_version: 1 }],
  ["save_custom_ingredient", { p_key: "own_x", p_expected_version: 1, p_def: {} }],
  // I5 — receipt-learning.sql; лише для тих, хто увійшов.
  ["similar_receipt_names", { p_names: [], p_seller: null, p_chain: null }],
  // I6 — community-merge.sql.
  ["merge_products", { p_loser: NIL, p_winner: NIL }],
  ["unmerge_product", { p_loser: NIL }],
  ["merge_custom_ingredients", { p_loser: "own_x", p_winner: "own_y" }],
  ["unmerge_custom_ingredient", { p_loser: "own_x" }],
]) {
  await expectClosed(fn, () => post(`rpc/${fn}`, body));
}

if (rpcBroken) {
  console.log(
    "\n→ Функцій каталогу бракує або вони відкриті не тим. Виконай supabase/products.sql," +
      " supabase/receipt-learning.sql і supabase/community-merge.sql (до деплою коду).",
  );
  process.exit(1);
}

console.log(
  timers.ok
    ? "\n✓ timer_pushes — будильник готування з сервера"
    : "\n· timer_pushes немає — будильник готування дзвонить лише у відкритому застосунку (supabase/timer-push.sql)",
);

/*
 * Кожен вбудований тип із коду мусить бути в базі. Інакше новий продукт
 * каталогу не стане батьком дописаного типу (23503 «Немає типу …»), а
 * builtin-ingredients.sql просто забули запустити перед деплоєм.
 */
const { INGREDIENTS } = await jiti.import(resolve("src/data/ingredients.ts"));
const builtin = await fetch(`${URL_}/rest/v1/builtin_ingredients?select=key,parent_key`, { headers })
  .then(async (res) => (res.ok ? res.json() : null))
  .catch(() => null);
if (!builtin) {
  console.log("\n✗ builtin_ingredients не читається — виконай supabase/builtin-ingredients.sql");
  process.exit(1);
}
const mirrored = new Map(builtin.map((r) => [r.key, r.parent_key]));
const absent = INGREDIENTS.filter((d) => !mirrored.has(d.key)).map((d) => d.key);
const stale = INGREDIENTS.filter((d) => mirrored.has(d.key) && (mirrored.get(d.key) ?? undefined) !== d.parent).map((d) => d.key);
if (absent.length || stale.length) {
  if (absent.length) console.log(`\n✗ немає в builtin_ingredients: ${absent.join(", ")}`);
  if (stale.length) console.log(`✗ інший батько в builtin_ingredients: ${stale.join(", ")}`);
  console.log("→ Виконай supabase/builtin-ingredients.sql (до деплою коду).");
  process.exit(1);
}
console.log(`\n✓ builtin_ingredients — усі ${INGREDIENTS.length} вбудованих типів із батьками`);

const recipes = await get("recipes?select=id&limit=1");
if (recipes.count === "0") {
  console.log("\n→ Схема на місці, але рецептів немає. Виконай supabase/seed.sql.");
} else {
  console.log(`\n✓ Усе готово. Рецептів у базі: ${recipes.count}`);
}
