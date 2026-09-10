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
];

console.log("\nТаблиці та вʼюхи:");
let missing = 0;
for (const [name, path] of checks) {
  const r = await get(`${path}&limit=1`);
  if (r.ok) {
    console.log(`  ✓ ${name.padEnd(22)} рядків: ${r.count ?? "?"}`);
  } else {
    missing++;
    console.log(`  ✗ ${name.padEnd(22)} ${r.status} ${r.body ?? ""}`);
  }
}

if (missing) {
  console.log("\n→ Виконай supabase/schema.sql у Supabase SQL Editor.");
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
const { PANTRY_SELECT } = await createJiti(import.meta.url, {
  alias: { "@": resolve("src") },
  interopDefault: true,
}).import(resolve("src/lib/supabase/api.ts"));
selects.push(["pantry_items", PANTRY_SELECT]);

console.log("\nКолонки, які запитує код:");
let broken = 0;
for (const [table, columns] of selects) {
  const r = await get(`${table}?select=${encodeURIComponent(columns)}&limit=0`);
  if (r.ok) {
    console.log(`  ✓ ${table.padEnd(22)} ${columns}`);
  } else {
    broken++;
    console.log(`  ✗ ${table.padEnd(22)} ${r.body ?? r.status}`);
  }
}

if (broken) {
  console.log("\n→ Список колонок у api.ts розійшовся зі схемою бази.");
  process.exit(1);
}

const recipes = await get("recipes?select=id&limit=1");
if (recipes.count === "0") {
  console.log("\n→ Схема на місці, але рецептів немає. Виконай supabase/seed.sql.");
} else {
  console.log(`\n✓ Усе готово. Рецептів у базі: ${recipes.count}`);
}
