/**
 * Генерує supabase/seed.sql з тих самих демо-даних, що використовує застосунок
 * у локальному режимі. Так база й офлайн-версія лишаються синхронними.
 *
 *   node scripts/generate-seed-sql.mjs
 */
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SEED_PROFILES, SEED_RECIPES } from "../src/data/seed.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "../supabase/seed.sql");

/** Стабільний UUID з рядка — щоб повторний запуск не плодив дублікатів. */
function stableUuid(input) {
  const h = createHash("md5").update(`nyam:${input}`).digest("hex");
  // Виставляємо версію 3 та варіант RFC 4122, щоб Postgres прийняв значення.
  const v = "3" + h.slice(13, 16);
  const r = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v}-${r}-${h.slice(20, 32)}`;
}

const q = (value) => {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
};

const arr = (items) =>
  items.length ? `array[${items.map(q).join(", ")}]::text[]` : `'{}'::text[]`;

const json = (value) => `${q(JSON.stringify(value))}::jsonb`;

const lines = [
  "-- ============================================================================",
  `--  Ням — демо-спільнота: ${SEED_PROFILES.length} кухарів, ${SEED_RECIPES.length} рецептів.`,
  "--",
  "--  ЗГЕНЕРОВАНО автоматично: node scripts/generate-seed-sql.mjs",
  "--  Не редагуй вручну: зміни вноси у src/data/seed.ts і перегенеруй.",
  "--",
  "--  Виконувати ПІСЛЯ supabase/schema.sql. Запуск повторно безпечний.",
  "-- ============================================================================",
  "",
];

// ── Профілі ────────────────────────────────────────────────────────────────
lines.push("-- Кухарі");
for (const p of SEED_PROFILES) {
  lines.push(
    `insert into public.profiles (id, handle, name, emoji, gradient, bio, city, is_demo) values (`,
    `  ${q(stableUuid(p.id))}, ${q(p.handle)}, ${q(p.name)}, ${q(p.emoji)},`,
    `  ${arr(p.gradient)}, ${q(p.bio)}, ${q(p.city ?? null)}, true`,
    `) on conflict (id) do update set`,
    `  handle = excluded.handle, name = excluded.name, emoji = excluded.emoji,`,
    `  gradient = excluded.gradient, bio = excluded.bio, city = excluded.city;`,
    "",
  );
}

// ── Рецепти ────────────────────────────────────────────────────────────────
lines.push("-- Рецепти");
for (const r of SEED_RECIPES) {
  const ingredients = r.ingredients.map((i) => ({
    key: i.key,
    qty: i.qty ?? null,
    optional: i.optional ?? false,
  }));
  const steps = r.steps.map((s) => ({
    text: s.text,
    timerSec: s.timerSec ?? null,
    tip: s.tip ?? null,
  }));

  lines.push(
    `insert into public.recipes (`,
    `  id, author_id, title, description, emoji, gradient, cuisine,`,
    `  meal_types, moods, tags, time_min, difficulty, servings, kcal, cost_level,`,
    `  ingredients, steps, created_at,`,
    `  seed_likes, seed_saves, seed_cooks, seed_rating_sum, seed_rating_count`,
    `) values (`,
    `  ${q(stableUuid(r.id))}, ${q(stableUuid(r.authorId))}, ${q(r.title)}, ${q(r.description)},`,
    `  ${q(r.emoji)}, ${arr(r.gradient)}, ${q(r.cuisine)},`,
    `  ${arr(r.mealTypes)}, ${arr(r.moods)}, ${arr(r.tags)},`,
    `  ${r.timeMin}, ${r.difficulty}, ${r.servings}, ${r.kcal ?? "null"}, ${r.costLevel},`,
    `  ${json(ingredients)}, ${json(steps)}, ${q(r.createdAt)},`,
    `  ${r.stats.likes}, ${r.stats.saves}, ${r.stats.cooks}, ${r.stats.ratingSum}, ${r.stats.ratingCount}`,
    `) on conflict (id) do update set`,
    `  title = excluded.title, description = excluded.description, emoji = excluded.emoji,`,
    `  gradient = excluded.gradient, cuisine = excluded.cuisine,`,
    `  meal_types = excluded.meal_types, moods = excluded.moods, tags = excluded.tags,`,
    `  time_min = excluded.time_min, difficulty = excluded.difficulty,`,
    `  servings = excluded.servings, kcal = excluded.kcal, cost_level = excluded.cost_level,`,
    `  ingredients = excluded.ingredients, steps = excluded.steps,`,
    `  seed_likes = excluded.seed_likes, seed_saves = excluded.seed_saves,`,
    `  seed_cooks = excluded.seed_cooks, seed_rating_sum = excluded.seed_rating_sum,`,
    `  seed_rating_count = excluded.seed_rating_count;`,
    "",
  );
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join("\n"), "utf8");

console.log(
  `✓ supabase/seed.sql — ${SEED_PROFILES.length} профілів, ${SEED_RECIPES.length} рецептів`,
);

// ── Склеєний файл для копіювання одним шматком ─────────────────────────────
const schemaPath = resolve(here, "../supabase/schema.sql");
const setupPath = resolve(here, "../supabase/setup.sql");
const NOTIFY = "notify pgrst, 'reload schema';";

const schema = readFileSync(schemaPath, "utf8").replace(NOTIFY, "").trimEnd();
// Прибираємо власну шапку seed.sql — у склеєному файлі вона зайва.
const seed = lines.slice(9).join("\n");

writeFileSync(
  setupPath,
  [
    "-- ============================================================================",
    "--  Ням — ПОВНЕ налаштування бази за один запуск.",
    "--",
    "--  Це supabase/schema.sql + supabase/seed.sql в одному файлі.",
    "--  Встав усе це в Supabase → SQL Editor → Run. Повторний запуск безпечний.",
    "--",
    "--  ЗГЕНЕРОВАНО: node scripts/generate-seed-sql.mjs",
    "-- ============================================================================",
    "",
    "",
    schema,
    "",
    "",
    "-- ============================================================================",
    "--  ЧАСТИНА 2: демо-спільнота",
    "-- ============================================================================",
    "",
    seed,
    "",
    "-- Скидаємо кеш схеми PostgREST, інакше перші запити дадуть 404.",
    NOTIFY,
    "",
  ].join("\n"),
  "utf8",
);

console.log("✓ supabase/setup.sql — схема + дані одним файлом");
