#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createJiti } from "jiti";

/**
 * Калорії рецептів від ШІ — порахувати ті, що вже лежать у базі.
 *
 *   npm run nutrition:recompute                  — лише рецепти без числа
 *   npm run nutrition:recompute -- --all         — усі, наново (після зміни підказки чи моделі)
 *   npm run nutrition:recompute -- --dry         — порахувати й показати, нічого не записуючи
 *   npm run nutrition:recompute -- <id> [<id>…]  — лише ці рецепти (разом із --dry — ще й розклад)
 *
 * Нові й змінені рецепти рахує сама база через /api/recipe/nutrition
 * (supabase/recipe-nutrition.sql); цей скрипт — для того, що було до неї, і
 * для перерахунку всього разом. Той самий модуль, що й у маршруті, тож і
 * підказка, і перевірки, і модель — ті самі.
 *
 * Потрібні GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY
 * у .env чи .env.local: записувати ai_nutrition тригер дозволяє лише службовому
 * ключу.
 */

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

const env = { ...loadEnv(), ...process.env };
const KEY = env.GEMINI_API_KEY;
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

for (const [name, value] of [
  ["GEMINI_API_KEY", KEY],
  ["NEXT_PUBLIC_SUPABASE_URL", URL],
  ["SUPABASE_SERVICE_ROLE_KEY", SERVICE],
]) {
  if (!value) {
    console.error(`✗ Немає ${name}. Поклади його в .env.local за зразком .env.example`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
const all = args.includes("--all");
const dryRun = args.includes("--dry");
const only = args.filter((a) => !a.startsWith("--"));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const { recomputeRecipeNutrition } = await jiti.import(path.join(root, "src/lib/nutrition-ai.ts"));
const { GEMINI_MODEL } = await jiti.import(path.join(root, "src/lib/vision.ts"));

const sb = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let query = sb.from("recipes").select("id,title,servings,ai_nutrition").order("created_at");
if (only.length) query = query.in("id", only);
else if (!all) query = query.is("ai_nutrition", null);
const { data: recipes, error } = await query;
if (error) {
  console.error(`✗ Рецепти не прочитались: ${error.message}`);
  console.error("  Чи виконано supabase/recipe-nutrition.sql?");
  process.exit(1);
}

console.log(
  `── ${recipes.length} ${dryRun ? "рецептів, без запису" : "рецептів"} · ${GEMINI_MODEL} ──\n`,
);

const tally = {};
let input = 0;
let output = 0;

for (const recipe of recipes) {
  const outcome = await recomputeRecipeNutrition(sb, recipe.id, {
    key: KEY,
    deadline: Date.now() + 60_000,
    force: all || only.length > 0,
    dryRun,
  });
  tally[outcome.status] = (tally[outcome.status] ?? 0) + 1;

  const servings = Math.max(1, recipe.servings || 1);
  if (outcome.status === "saved") {
    const n = outcome.nutrition;
    const before = recipe.ai_nutrition?.kcal;
    input += outcome.usage?.input ?? 0;
    output += outcome.usage?.output ?? 0;
    console.log(
      `✓ ${recipe.title}: ${Math.round(n.kcal / servings)} ккал на порцію` +
        ` (${n.kcal} на всю страву, ${servings} ${servings === 1 ? "порція" : "порції"};` +
        ` Б ${n.protein} · Ж ${n.fat} · В ${n.carbs})` +
        (before != null && before !== n.kcal ? ` — було ${before}` : ""),
    );
    if (n.note) console.log(`    ${n.note}`);
    if (dryRun && only.length) {
      for (const item of outcome.items) console.log(`      ${item.name}: ${item.grams} г — ${item.kcal} ккал`);
    }
  } else if (outcome.status === "failed") {
    console.log(`✗ ${recipe.title}: ${outcome.reason} — ${outcome.cause}`);
    if (outcome.reason === "misconfigured") {
      console.log("\nКлюч, модель чи квота — решта впаде так само. Перевір: npm run check:gemini");
      break;
    }
  } else {
    console.log(`· ${recipe.title}: ${outcome.status}`);
  }
}

console.log(
  `\n${Object.entries(tally)
    .map(([status, count]) => `${status}: ${count}`)
    .join(" · ")}` +
    // Ціни 3.1-flash-lite: $0,25 / $1,50 за мільйон (див. src/lib/vision.ts).
    (input ? ` · токенів ${input} + ${output} ≈ $${((input * 0.25 + output * 1.5) / 1e6).toFixed(4)}` : ""),
);

if (tally.failed) process.exit(1);
