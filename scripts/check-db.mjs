/**
 * Перевіряє, чи готова база: чи валідні ключі, чи накатана схема,
 * чи залиті демо-дані.
 *
 *   npm run db:check
 */
import { readFileSync, existsSync } from "node:fs";

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
  `  вхід поштою: ${auth.external?.email ? "увімкнено" : "вимкнено"}` +
    `, підтвердження пошти: ${auth.mailer_autoconfirm === false ? "ОБОВʼЯЗКОВЕ" : "вимкнено"}`,
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

const recipes = await get("recipes?select=id&limit=1");
if (recipes.count === "0") {
  console.log("\n→ Схема на місці, але рецептів немає. Виконай supabase/seed.sql.");
} else {
  console.log(`\n✓ Усе готово. Рецептів у базі: ${recipes.count}`);
}
