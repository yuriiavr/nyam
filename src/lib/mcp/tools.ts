import "server-only";

import { randomUUID } from "node:crypto";
import { findIngredient, ing, knownIngredient } from "@/data/ingredients";
import {
  addNutrition,
  forGrams,
  itemsNutrition,
  mealItem,
  portionLabel,
  portionPresets,
  roundNutrition,
  scaleNutrition,
  SLOT_META,
  ZERO,
} from "@/lib/diary";
import { estimateProduct, parseDish, type PantryChoice } from "@/lib/food-ai";
import {
  MENU_SLOTS,
  menuDish,
  planMenu,
  scaleTargets,
  slotShare,
  type MenuDish,
  type MenuPick,
  type MenuTargets,
} from "@/lib/menu";
import {
  consumeRows,
  pantryDisplayName,
  parsePantryTaken,
  productTakes,
  returnTaken,
  takenFrom,
  type Consumed,
  type ProductCache,
} from "@/lib/pantry";
import type { Product } from "@/lib/product-types";
import type { MealSlot, Nutrition, PantryItem, PantryTaken, PlanSlot, Unit } from "@/lib/types";
import { formatNumber, formatQuantity } from "@/lib/units";
import { plural } from "@/lib/utils";
import {
  PANTRY_COLUMNS,
  PRODUCT_COLUMNS,
  RECIPE_COLUMNS,
  recipeFromRow,
  dayBounds,
  db,
  eatenAt,
  familyOf,
  localDay,
  localSlot,
  pantryFromRow,
  pantryToDbRow,
  productById,
  productFromRow,
  publicDb,
  safeTz,
} from "./db";

/**
 * Інструменти голосового помічника: що він може зробити від імені людини.
 *
 * Відповідь — коротким українським текстом: помічник переказує її вголос,
 * тож «Записано: батончик Корона, 50 г — 265 ккал. Сьогодні 1420 з 2000»
 * корисніше за JSON. Поруч — structuredContent для клієнтів, що його читають.
 *
 * Пише службовий ключ, тож кожен запит тут явно обмежений людиною з ключа.
 */

export interface Ctx {
  userId: string;
  /** Адреса застосунку — для посилань, які помічник може відкрити людині. */
  origin: string;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  run: (args: Record<string, unknown>, ctx: Ctx) => Promise<ToolResult>;
}

const SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PACK_UNITS = new Set(["g", "kg", "ml", "l", "pcs"]);

const text = (t: string, structured?: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: t }],
  ...(structured ? { structuredContent: structured } : {}),
});
const fail = (t: string): ToolResult => ({ content: [{ type: "text", text: t }], isError: true });

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const numArg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() ? Number(v.replace(",", ".")) : NaN);

const SLOT_SCHEMA = {
  type: "string",
  enum: SLOTS,
  description: "Прийом їжі: breakfast, lunch, dinner або snack. Не вказано — за поточною годиною.",
};
const DATE_SCHEMA = {
  type: "string",
  description: "День у форматі YYYY-MM-DD за часом людини. Не вказано — сьогодні.",
};
const TZ_SCHEMA = {
  type: "string",
  description: "Часовий пояс IANA, як-от Europe/Kyiv. Не вказано — Europe/Kyiv.",
};

function when(args: Record<string, unknown>) {
  const tz = safeTz(args.timezone);
  const now = new Date();
  const day = typeof args.date === "string" && DAY_RE.test(args.date) ? args.date : localDay(now, tz);
  const slot = SLOTS.includes(args.slot as MealSlot) ? (args.slot as MealSlot) : localSlot(now, tz);
  return { tz, day, slot, at: eatenAt(day, slot, tz, now) };
}

function productLine(p: Product): string {
  const pack = p.packAmount != null && p.packUnit ? formatQuantity(p.packAmount, p.packUnit as Unit) : "";
  const kcal = p.nutrition
    ? `${p.nutritionSource === "ai" ? "≈" : ""}${Math.round(p.nutrition.kcal)} ккал/100 г`
    : "КБЖВ невідомі";
  return [p.name, p.brand && !p.name.includes(p.brand) ? p.brand : "", pack, kcal].filter(Boolean).join(" · ");
}

const kcalLine = (n: Nutrition) =>
  `${Math.round(n.kcal)} ккал (Б ${formatNumber(n.protein, 1)} · Ж ${formatNumber(n.fat, 1)} · В ${formatNumber(n.carbs, 1)})`;

/**
 * Денні цілі людини з налаштувань щоденника (незадані — undefined) і апетит:
 * скільки порцій рецепта вона зазвичай зʼїдає.
 */
async function goalsOf(userId: string): Promise<{ targets: MenuTargets; appetite: number }> {
  const { data } = await db()
    .from("diary_settings")
    .select("kcal_goal,protein_goal,fat_goal,carbs_goal,appetite")
    .eq("user_id", userId)
    .maybeSingle();
  const pos = (v: unknown) => (v != null && Number(v) > 0 ? Number(v) : undefined);
  return {
    targets: {
      kcal: pos(data?.kcal_goal),
      protein: pos(data?.protein_goal),
      fat: pos(data?.fat_goal),
      carbs: pos(data?.carbs_goal),
    },
    appetite: pos(data?.appetite) ?? 1,
  };
}

const hasTarget = (t: MenuTargets) => Boolean(t.kcal || t.protein || t.fat || t.carbs);

/** «2000 ккал · Б 150 · Ж 70 · В 200» — лише задане. */
const targetLine = (t: MenuTargets) =>
  [
    t.kcal ? `${Math.round(t.kcal)} ккал` : "",
    t.protein ? `Б ${Math.round(t.protein)}` : "",
    t.fat ? `Ж ${Math.round(t.fat)}` : "",
    t.carbs ? `В ${Math.round(t.carbs)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

const MACRO_NAMES = [
  ["protein", "білки"],
  ["fat", "жири"],
  ["carbs", "вуглеводи"],
] as const;

/** «БЖВ: білки 80 з 150 г (лишилось 70), …» — лише для заданих цілей. */
function macroGoalLine(sum: Nutrition, goals: MenuTargets): string {
  const parts = MACRO_NAMES.flatMap(([k, name]) => {
    const goal = goals[k];
    if (!goal) return [];
    const have = Math.round(sum[k]);
    return [`${name} ${have} з ${goal} г (${have <= goal ? `лишилось ${goal - have}` : `понад на ${have - goal}`})`];
  });
  return parts.length ? `БЖВ: ${parts.join(", ")}.` : "";
}

/** Підсумок дня — те, що помічник скаже після запису. */
async function dayTotal(userId: string, day: string, tz: string): Promise<{ kcal: number; goal?: number }> {
  const [from, to] = dayBounds(day, tz);
  const [entries, goals] = await Promise.all([
    db().from("food_log").select("kcal").eq("user_id", userId).gte("eaten_at", from).lt("eaten_at", to),
    goalsOf(userId),
  ]);
  const kcal = Math.round((entries.data ?? []).reduce((s, r) => s + (Number(r.kcal) || 0), 0));
  return { kcal, goal: goals.targets.kcal };
}

const totalSentence = (t: { kcal: number; goal?: number }, today: boolean) =>
  `${today ? "Сьогодні" : "За цей день"} ${t.kcal}${t.goal ? ` з ${t.goal}` : ""} ккал.`;

/** Комора сімʼї як вибір для ШІ: id, назва, тип. */
async function pantryChoices(userId: string): Promise<{ choices: PantryChoice[]; products: Map<string, Product>; rows: Map<string, { key: string; productId?: string }> }> {
  const family = await familyOf(userId);
  const { data } = await db()
    .from("pantry_items")
    .select("id,ingredient_key,product_id,label,amount,unit,added_at")
    .in("user_id", family)
    .order("added_at", { ascending: false })
    .limit(200);
  const list = data ?? [];
  const ids = [...new Set(list.map((r) => r.product_id).filter(Boolean) as string[])];
  const products = new Map<string, Product>();
  if (ids.length) {
    const { data: cards } = await db().from("products").select(PRODUCT_COLUMNS).in("id", ids.slice(0, 150));
    for (const row of cards ?? []) {
      const p = productFromRow(row as Record<string, unknown>);
      products.set(p.id, p);
    }
  }
  const rows = new Map<string, { key: string; productId?: string }>();
  const choices = list
    .sort((a, b) => Number(b.amount != null) - Number(a.amount != null))
    .map((r) => {
      const key = String(r.ingredient_key);
      const product = r.product_id ? products.get(r.product_id as string) : undefined;
      rows.set(String(r.id), { key, ...(product ? { productId: product.id } : {}) });
      const piece = product?.gramsPerPiece ?? (knownIngredient(key) ? ing(key).gramsPerPiece : undefined);
      return {
        id: String(r.id),
        name: product?.name ?? (r.label as string | null) ?? ing(key).label,
        type: ing(key).label,
        ...(piece ? { gramsPerPiece: piece } : {}),
      };
    });
  return { choices, products, rows };
}

/* ── Комора: списати й повернути ──────────────────────────────────────── */

async function productCache(ids: readonly string[]): Promise<ProductCache> {
  const list = [...new Set(ids)].filter((id) => UUID_RE.test(id)).slice(0, 150);
  if (!list.length) return {};
  const { data } = await db().from("products").select(PRODUCT_COLUMNS).in("id", list);
  return Object.fromEntries(
    (data ?? []).map((row) => {
      const p = productFromRow(row as Record<string, unknown>);
      return [p.id, p];
    }),
  );
}

/**
 * Списує з рядків комори тими ж функціями, що й застосунок.
 *
 * Кожен рядок пишемо з умовою «кількість та сама, що ми бачили»: якщо тим
 * часом хтось із сімʼї взяв із тієї ж пачки, рядок пропускаємо, а не
 * затираємо чужу правку старим числом.
 */
async function takeFromPantry(
  rows: PantryItem[],
  takes: Array<{ id: string; grams: number }>,
  products: ProductCache,
): Promise<{ taken: PantryTaken[]; consumed: Consumed[] }> {
  const result = consumeRows(rows, takes, products);
  const after = new Map(result.pantry.map((row) => [row.id, row]));
  const taken: PantryTaken[] = [];
  for (const t of takenFrom(rows, result.pantry, result.consumed.map((c) => c.id))) {
    const rest = after.get(t.row.id);
    const had = t.row.amount as number;
    const { data, error } = rest
      ? await db().from("pantry_items").update({ amount: rest.amount }).eq("id", t.row.id).eq("amount", had).select("id")
      : await db().from("pantry_items").delete().eq("id", t.row.id).eq("amount", had).select("id");
    if (!error && data?.length) taken.push(t);
  }
  const done = new Set(taken.map((t) => t.row.id));
  return { taken, consumed: result.consumed.filter((c) => done.has(c.id)) };
}

/** Повертає взяте в комору сімʼї. Віддає назви повернутого — для відповіді. */
async function giveBack(userId: string, taken: readonly PantryTaken[]): Promise<string[]> {
  if (!taken.length) return [];
  const family = await familyOf(userId);
  const { data } = await db()
    .from("pantry_items")
    .select(PANTRY_COLUMNS)
    .in("id", taken.map((t) => t.row.id))
    .in("user_id", family);
  const now = (data ?? []).map((row) => pantryFromRow(row as Record<string, unknown>));
  const products = await productCache(taken.flatMap((t) => (t.row.productId ? [t.row.productId] : [])));
  const names: string[] = [];
  for (const row of returnTaken(now, taken)) {
    const owner = row.ownerId && family.includes(row.ownerId) ? row.ownerId : userId;
    const { error } = now.some((r) => r.id === row.id)
      ? await db().from("pantry_items").update({ amount: row.amount }).eq("id", row.id)
      : await db().from("pantry_items").insert(pantryToDbRow(row, owner));
    if (!error) names.push(pantryDisplayName(row, products));
  }
  return names;
}

const takenLine = (consumed: Consumed[]) =>
  consumed.map((c) => (c.left ? `${c.label} (лишилось ${c.left})` : `${c.label} (закінчився)`)).join(", ");

/* ── Меню під ціль ────────────────────────────────────────────────────── */

const WEEKDAY = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];

/** «2026-11-03» плюс n днів. */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** «пн 03.11». */
function dayName(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}

/** «654 ккал · Б 26 · Ж 30 · В 71» — у меню без десятих: це план, а не етикетка. */
const menuNutrition = (n?: Nutrition) =>
  n
    ? `${Math.round(n.kcal)} ккал · Б ${Math.round(n.protein)} · Ж ${Math.round(n.fat)} · В ${Math.round(n.carbs)}`
    : "КБЖВ невідомі";

const pickLine = (p: MenuPick) => `${p.dish.title}, ${portionLabel(p.portions)}${p.kept ? " (уже в плані)" : ""}`;

/**
 * Рецепти для меню: публічні й рецепти сімʼї (приватні теж — сімʼя їх і так
 * бачить). Приховані людиною («не пропонувати») у добір не йдуть, але як уже
 * заплановані впізнаються. `planned` — id із плану, яких може не бути серед
 * свіжих 500.
 */
async function menuRecipes(userId: string, family: string[], planned: string[]) {
  const visible = `is_public.eq.true,author_id.in.(${family.join(",")})`;
  const [recipes, dismissed] = await Promise.all([
    db().from("recipes").select(RECIPE_COLUMNS).or(visible).order("created_at", { ascending: false }).limit(500),
    db().from("dismissed").select("recipe_id").eq("user_id", userId),
  ]);
  if (recipes.error) return null;
  const rows = [...(recipes.data ?? [])];
  const missing = [...new Set(planned)].filter((id) => UUID_RE.test(id) && !rows.some((r) => r.id === id));
  if (missing.length) {
    const { data } = await db().from("recipes").select(RECIPE_COLUMNS).or(visible).in("id", missing);
    rows.push(...(data ?? []));
  }
  const dishes = new Map(rows.map((row) => [String(row.id), menuDish(recipeFromRow(row as Record<string, unknown>))]));
  const hidden = new Set((dismissed.data ?? []).map((r) => String(r.recipe_id)));
  return { dishes, candidates: [...dishes.values()].filter((d) => !hidden.has(d.id)) };
}

/* ── Інструменти ──────────────────────────────────────────────────────── */

export const TOOLS: ToolDef[] = [
  {
    name: "search_products",
    title: "Знайти товар",
    description:
      "Шукає товар у каталозі Ням за назвою й брендом (наприклад «молоко безлактозне Галичина», «батончик Корона»). " +
      "Повертає id, назву, упаковку й калорії на 100 г. Викликай перед log_product чи add_to_pantry, щоб отримати product_id.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Назва товару, можна з брендом і жирністю." },
        limit: { type: "integer", minimum: 1, maximum: 15, description: "Скільки варіантів повернути (типово 6)." },
      },
      required: ["query"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: async (args) => {
      const query = str(args.query, 120);
      if (query.length < 2) return fail("Потрібна назва товару — хоча б дві літери.");
      const limit = Math.min(15, Math.max(1, Math.round(numArg(args.limit)) || 6));
      const { data, error } = await publicDb().rpc("search_products", {
        p_query: query,
        p_type_keys: null,
        p_limit: limit,
      });
      if (error) return fail("Каталог зараз не відповідає. Спробуй ще раз.");
      const products = ((data ?? []) as Record<string, unknown>[]).map(productFromRow);
      if (products.length === 0) {
        return text(
          `У каталозі немає «${query}». Можна записати як страву через log_dish — калорії оцінить ШІ.`,
          { products: [] },
        );
      }
      return text(
        products.map((p, i) => `${i + 1}. ${productLine(p)} — id ${p.id}`).join("\n"),
        {
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            brand: p.brand ?? null,
            pack: p.packAmount != null ? `${p.packAmount} ${p.packUnit}` : null,
            kcal_per_100g: p.nutrition?.kcal ?? null,
            nutrition_estimated: p.nutritionSource === "ai",
          })),
        },
      );
    },
  },

  {
    name: "log_product",
    title: "Записати зʼїдений товар",
    description:
      "Записує в щоденник людини зʼїдений товар із каталогу (product_id з search_products). " +
      "Кількість — grams, або portion: pack (уся пачка), half (пів пачки), piece (1 шт). Нічого не вказано — типова порція. " +
      "Якщо такий товар є в коморі сімʼї, списує його звідти; купив не вдома (дорогою, у кафе) — from_pantry: false.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "id товару з search_products." },
        grams: { type: "number", minimum: 1, maximum: 5000, description: "Скільки грамів (мл) зʼїв." },
        portion: { type: "string", enum: ["pack", "half", "piece"], description: "Замість грамів." },
        from_pantry: {
          type: "boolean",
          description: "false — товар не з дому, комору не чіпати. Типово true: є в коморі — списати.",
        },
        slot: SLOT_SCHEMA,
        date: DATE_SCHEMA,
        timezone: TZ_SCHEMA,
      },
      required: ["product_id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: async (args, { userId }) => {
      const id = str(args.product_id, 40);
      if (!UUID_RE.test(id)) return fail("Невідомий product_id — спершу знайди товар через search_products.");
      const product = await productById(id);
      if (!product) return fail("Такого товару немає в каталозі.");

      const presets = portionPresets(product, knownIngredient(product.typeKey) ? ing(product.typeKey).gramsPerPiece : undefined);
      const pack = presets.find((p) => p.kind === "pack");
      const half = presets.find((p) => p.kind === "half");
      const piece = presets.find((p) => p.kind === "piece");
      const asked = numArg(args.grams);
      const grams =
        asked > 0 && asked <= 5000
          ? asked
          : args.portion === "pack"
            ? (pack?.grams ?? presets[0]?.grams ?? 100)
            : args.portion === "half"
              ? (half?.grams ?? 50)
              : args.portion === "piece"
                ? (piece?.grams ?? presets[0]?.grams ?? 100)
                : (presets[0]?.grams ?? 100);

      // Етикетка → оцінка на картці → середнє для типу → оцінка ШІ зараз.
      let per100 = product.nutrition ?? (knownIngredient(product.typeKey) ? ing(product.typeKey).nutrition : undefined);
      let note = !product.nutrition && per100 ? ` (КБЖВ на картці немає — пораховано за середнім для «${ing(product.typeKey).label}»)` : "";
      if (!per100 && process.env.GEMINI_API_KEY) {
        const est = await estimateProduct(
          { name: product.name, brand: product.brand, type: ing(product.typeKey).label, fatPct: product.fatPct },
          { key: process.env.GEMINI_API_KEY, deadline: Date.now() + 20_000 },
        );
        if (est.ok) {
          per100 = est.value.nutrition;
          note = " (≈ оцінка ШІ: на картці немає КБЖВ — сфотографуй етикетку в застосунку)";
        }
      }
      const nutrition = per100 ? forGrams(per100, grams) : undefined;
      const { tz, day, slot, at } = when(args);

      const entryId = randomUUID();
      const { error } = await db()
        .from("food_log")
        .insert({
          id: entryId,
          user_id: userId,
          logged_by: userId,
          eaten_at: at,
          slot,
          title: product.name.slice(0, 160),
          emoji: knownIngredient(product.typeKey) ? ing(product.typeKey).emoji : "🍽️",
          product_id: product.id,
          grams: Math.round(grams * 10) / 10,
          kcal: nutrition?.kcal ?? null,
          protein: nutrition?.protein ?? null,
          fat: nutrition?.fat ?? null,
          carbs: nutrition?.carbs ?? null,
          source: "voice",
        });
      if (error) return fail("Не вдалося записати — спробуй ще раз.");

      // Запис уже є; комора — слідом. Не вдалося списати — калорії однаково записані.
      let fromPantry: Consumed[] = [];
      if (args.from_pantry !== false) {
        const family = await familyOf(userId);
        const { data: own } = await db()
          .from("pantry_items")
          .select(PANTRY_COLUMNS)
          .in("user_id", family)
          .eq("product_id", product.id);
        const rows = (own ?? []).map((row) => pantryFromRow(row as Record<string, unknown>));
        const cache = { [product.id]: product };
        const takes = productTakes(rows, product.id, grams, cache);
        if (takes.length) {
          const used = await takeFromPantry(rows, takes, cache);
          if (used.taken.length) {
            await db().from("food_log").update({ pantry_taken: used.taken }).eq("id", entryId);
            fromPantry = used.consumed;
          }
        }
      }

      const total = await dayTotal(userId, day, tz);
      const today = day === localDay(new Date(), tz);
      return text(
        `Записано в ${SLOT_META[slot].label.toLowerCase()}: ${product.name}, ${formatNumber(grams, 0)} г — ${
          nutrition ? kcalLine(nutrition) : "калорії невідомі"
        }${note}.${fromPantry.length ? ` Списав з комори: ${takenLine(fromPantry)}.` : ""} ${totalSentence(total, today)}`,
        {
          entry_id: entryId,
          grams,
          kcal: nutrition?.kcal ?? null,
          day_kcal: total.kcal,
          goal: total.goal ?? null,
          from_pantry: fromPantry.map((c) => ({ name: c.label, used: c.used, left: c.left })),
        },
      );
    },
  },

  {
    name: "log_dish",
    title: "Записати страву словами",
    description:
      "Записує зʼїдену страву за описом («запечена картопля з двома сосисками», «тарілка борщу зі сметаною»). " +
      "ШІ розкладає на продукти, бере калорії з товарів у коморі людини, якщо вони там є, решту оцінює. " +
      "Якщо страву готували на кількох (servings > 1), людині записується portions порцій, решта лишається залишком. " +
      "Комору сам не списує: якщо продукти схоже з комори, повертає open_url — сторінку, де людина підтверджує, що саме взяли.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Що зʼїв, словами, з кількостями, якщо відомі." },
        portions: {
          type: "number",
          minimum: 0.25,
          maximum: 10,
          description: "Скільки порцій зʼїла людина, якщо страва на кількох. Типово 1.",
        },
        slot: SLOT_SCHEMA,
        date: DATE_SCHEMA,
        timezone: TZ_SCHEMA,
      },
      required: ["text"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    run: async (args, { userId, origin }) => {
      const what = str(args.text, 600);
      if (what.length < 2) return fail("Опиши, що зʼїв.");
      const key = process.env.GEMINI_API_KEY;
      if (!key) return fail("ШІ на сервері не налаштований — запиши товар через search_products і log_product.");

      const pantry = await pantryChoices(userId);
      const res = await parseDish(what, pantry.choices, { key, deadline: Date.now() + 25_000 });
      if (!res.ok) {
        return fail(
          res.reason === "upstream" ? "ШІ зараз не відповідає — спробуй за хвилину." : "Не вдалося розібрати страву — опиши інакше.",
        );
      }
      const dish = res.value;
      const items = dish.parts.map((part) => {
        const rowId = part.pantryIds.find((id) => pantry.rows.has(id));
        const row = rowId ? pantry.rows.get(rowId) : undefined;
        const product = row?.productId ? pantry.products.get(row.productId) : undefined;
        return mealItem({
          name: product?.name ?? part.name,
          grams: part.grams,
          product: product ?? null,
          typeKey: row?.key,
          pantryId: rowId,
          ai: part.per100,
        });
      });
      const total = itemsNutrition(items);
      const servings = Math.min(50, Math.max(1, dish.servings));
      const portions = Math.min(servings, Math.max(0.25, numArg(args.portions) || 1));
      const share = Math.min(1, Math.round((portions / servings) * 1000) / 1000);
      const mine = roundNutrition(scaleNutrition(total, share));
      const { tz, day, slot, at } = when(args);

      /*
       * Страва — завжди, навіть на одну порцію (як у застосунку): у ній склад
       * із рядками комори, за якими людина потім підтвердить списання.
       */
      const entryId = randomUUID();
      const mealId = randomUUID();
      {
        const { error } = await db().from("meals").insert({
          id: mealId,
          user_id: userId,
          title: dish.title.slice(0, 120),
          emoji: dish.emoji.slice(0, 16),
          servings,
          kcal: total.kcal,
          protein: total.protein,
          fat: total.fat,
          carbs: total.carbs,
          items,
          note: dish.note?.slice(0, 300) ?? null,
          cooked_at: at,
          eaten: 0,
          finished: false,
        });
        if (error) return fail("Не вдалося записати страву — спробуй ще раз.");
      }
      const { error } = await db()
        .from("food_log")
        .insert({
          id: entryId,
          user_id: userId,
          logged_by: userId,
          eaten_at: at,
          slot,
          title: dish.title.slice(0, 160),
          emoji: dish.emoji.slice(0, 16),
          meal_id: mealId,
          share,
          kcal: mine.kcal,
          protein: mine.protein,
          fat: mine.fat,
          carbs: mine.carbs,
          source: "voice",
        });
      if (error) return fail("Не вдалося записати — спробуй ще раз.");

      const fromPantry = items.filter((i) => i.pantryId).map((i) => i.name);
      const openUrl = fromPantry.length ? `${origin}/diary?take=${mealId}` : null;
      const day_total = await dayTotal(userId, day, tz);
      const today = day === localDay(new Date(), tz);
      const parts = items.map((i) => `${i.name} ${i.grams} г`).join(", ");
      const said = [
        `Записано: ${dish.title}${servings > 1 ? `, ${formatNumber(portions, 2)} з ${formatNumber(servings, 2)} порцій` : ""} — ${kcalLine(mine)}.`,
        `Склад: ${parts}.`,
        dish.note ? `Припущення: ${dish.note}` : "",
        servings - portions >= 0.25 ? "Решта лишилась у щоденнику залишком — доїсте пізніше." : "",
        totalSentence(day_total, today),
        fromPantry.length ? `Схоже, з комори брали: ${fromPantry.join(", ")} — спишу після підтвердження.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return text(
        openUrl ? `${said}\nСторінка підтвердження (відкрий людині, вголос не читай): ${openUrl}` : said,
        {
          entry_id: entryId,
          meal_id: mealId,
          kcal: mine.kcal,
          day_kcal: day_total.kcal,
          goal: day_total.goal ?? null,
          open_url: openUrl,
        },
      );
    },
  },

  {
    name: "add_to_pantry",
    title: "Покласти в комору",
    description:
      "Додає покупку в комору (холодильник) людини й сімʼї. Найкраще з product_id із search_products — тоді з упаковкою й калоріями. " +
      "Без товару в каталозі — name: тоді лягає як тип продукту («молоко», «яйця»).",
    inputSchema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "id товару з search_products." },
        name: { type: "string", description: "Назва, якщо товару немає в каталозі." },
        amount: { type: "number", minimum: 0, description: "Скільки (типово — одна упаковка)." },
        unit: { type: "string", enum: ["g", "kg", "ml", "l", "pcs"], description: "Одиниця для amount." },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: async (args, { userId }) => {
      const id = str(args.product_id, 40);
      const amount = numArg(args.amount);
      const unit = PACK_UNITS.has(String(args.unit)) ? (String(args.unit) as Unit) : undefined;
      let row: Record<string, unknown>;
      let label: string;

      if (id) {
        if (!UUID_RE.test(id)) return fail("Невідомий product_id — спершу знайди товар через search_products.");
        const product = await productById(id);
        if (!product) return fail("Такого товару немає в каталозі.");
        const pack = product.packAmount != null && product.packUnit;
        row = {
          ingredient_key: product.typeKey,
          product_id: product.id,
          amount: amount > 0 ? amount : pack ? product.packAmount : null,
          unit: amount > 0 ? (unit ?? product.packUnit ?? null) : pack ? product.packUnit : null,
        };
        label = product.name;
      } else {
        const name = str(args.name, 120);
        const def = name ? findIngredient(name) : null;
        if (!def) return fail(`Не знаю, що таке «${name}». Знайди товар через search_products.`);
        row = {
          ingredient_key: def.key,
          label: name.toLowerCase() === def.label.toLowerCase() ? null : name,
          amount: amount > 0 ? amount : null,
          unit: amount > 0 ? (unit ?? def.defaultUnit ?? "g") : null,
        };
        label = name;
      }

      const { error } = await db()
        .from("pantry_items")
        .insert({ id: randomUUID(), user_id: userId, added_at: new Date().toISOString(), ...row });
      if (error) return fail("Не вдалося покласти в комору — спробуй ще раз.");
      const qty = row.amount != null && row.unit ? `, ${formatQuantity(Number(row.amount), row.unit as Unit)}` : "";
      return text(`У коморі: ${label}${qty}.`, { ok: true });
    },
  },

  {
    name: "add_to_shopping",
    title: "Дописати в список покупок",
    description: "Дописує позицію в спільний список покупок сімʼї («купити молоко безлактозне»).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Що купити." },
        amount: { type: "number", minimum: 0 },
        unit: { type: "string", enum: ["g", "kg", "ml", "l", "pcs"] },
      },
      required: ["name"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    run: async (args, { userId }) => {
      const name = str(args.name, 120);
      if (name.length < 2) return fail("Що саме купити?");
      const def = findIngredient(name);
      const amount = numArg(args.amount);
      const unit = PACK_UNITS.has(String(args.unit)) ? String(args.unit) : null;
      const { error } = await db()
        .from("shopping_items")
        .insert({
          id: randomUUID(),
          user_id: userId,
          ingredient_key: def?.key ?? null,
          text: name,
          amount: amount > 0 ? amount : null,
          unit: amount > 0 ? unit : null,
          done: false,
          added_at: new Date().toISOString(),
          source: "manual",
        });
      if (error) return fail("Не вдалося дописати — спробуй ще раз.");
      return text(`У списку покупок: ${name}.`, { ok: true });
    },
  },

  {
    name: "get_diary",
    title: "Щоденник за день",
    description: "Що людина зʼїла за день: записи по прийомах їжі, калорії й БЖВ, ціль. Для «скільки я сьогодні зʼїв?».",
    inputSchema: {
      type: "object",
      properties: { date: DATE_SCHEMA, timezone: TZ_SCHEMA },
    },
    annotations: { readOnlyHint: true },
    run: async (args, { userId }) => {
      const { tz, day } = when(args);
      const [from, to] = dayBounds(day, tz);
      const [entries, goals] = await Promise.all([
        db()
          .from("food_log")
          .select("id,slot,title,grams,share,kcal,protein,fat,carbs,eaten_at")
          .eq("user_id", userId)
          .gte("eaten_at", from)
          .lt("eaten_at", to)
          .order("eaten_at"),
        goalsOf(userId),
      ]);
      if (entries.error) return fail("Щоденник зараз не відповідає.");
      const list = entries.data ?? [];
      const targets = goals.targets;
      const goal = targets.kcal;
      const sum = list.reduce<Nutrition>(
        (s, r) => ({
          kcal: s.kcal + (Number(r.kcal) || 0),
          protein: s.protein + (Number(r.protein) || 0),
          fat: s.fat + (Number(r.fat) || 0),
          carbs: s.carbs + (Number(r.carbs) || 0),
        }),
        { kcal: 0, protein: 0, fat: 0, carbs: 0 },
      );
      if (list.length === 0) {
        return text(`За ${day} записів немає.${hasTarget(targets) ? ` Ціль — ${targetLine(targets)}.` : ""}`, {
          entries: [],
          goals: targets,
        });
      }
      const lines = SLOTS.flatMap((slot) => {
        const rows = list.filter((r) => r.slot === slot);
        if (!rows.length) return [];
        return [
          `${SLOT_META[slot].label}: ${rows
            .map((r) => `${r.title}${r.kcal != null ? ` ${Math.round(Number(r.kcal))} ккал` : ""} (id ${r.id})`)
            .join("; ")}`,
        ];
      });
      return text(
        [
          `Разом за ${day}: ${kcalLine(sum)}${goal ? `, ціль ${goal} — ${sum.kcal <= goal ? `лишилось ${Math.round(goal - sum.kcal)}` : `понад на ${Math.round(sum.kcal - goal)}`}` : ""}.`,
          macroGoalLine(sum, targets),
          ...lines,
        ]
          .filter(Boolean)
          .join("\n"),
        { day, kcal: Math.round(sum.kcal), goal: goal ?? null, goals: targets, entries: list },
      );
    },
  },

  {
    name: "plan_menu",
    title: "Скласти меню під ціль",
    description:
      "Складає з рецептів Ням меню (сніданок, обід, вечеря) на день або тиждень так, щоб калорії й БЖВ були якомога ближче " +
      "до цілі людини (Ням → Налаштування → Щоденник), і каже, скільки порцій кожної страви зʼїсти. " +
      "Спершу виклич без save і перекажи меню; людина погодилась — той самий виклик із save: true запише його в план на тиждень " +
      "(порцій план не зберігає — назви їх). «Інший варіант» — той самий виклик із variant на 1 більше. " +
      "Те, що вже стоїть у плані на ці дні, лишається й зараховується в ціль; replace: true — скласти наново. " +
      "Добрати решту сьогоднішнього дня: спершу get_diary, далі slots — прийоми, що попереду, а kcal/protein/fat/carbs — залишок.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Перший день меню, YYYY-MM-DD за часом людини. Не вказано — сьогодні." },
        days: { type: "integer", minimum: 1, maximum: 7, description: "На скільки днів: 1 (типово), тиждень — 7." },
        slots: {
          type: "array",
          items: { type: "string", enum: MENU_SLOTS },
          description: "Які прийоми скласти: breakfast, lunch, dinner. Типово всі три.",
        },
        kcal: {
          type: "number",
          minimum: 0,
          description:
            "Ціль калорій саме на обрані прийоми за день. Не вказано жодного з kcal/protein/fat/carbs — денні цілі з налаштувань.",
        },
        protein: { type: "number", minimum: 0, description: "Ціль білків, г, на обрані прийоми за день." },
        fat: { type: "number", minimum: 0, description: "Ціль жирів, г, на обрані прийоми за день." },
        carbs: { type: "number", minimum: 0, description: "Ціль вуглеводів, г, на обрані прийоми за день." },
        replace: { type: "boolean", description: "true — скласти наново й те, що вже заплановано на ці дні." },
        save: { type: "boolean", description: "true — записати меню в план на тиждень. Лише після згоди людини." },
        variant: { type: "integer", minimum: 0, maximum: 99, description: "Номер варіанта меню; інший — на 1 більше. Типово 0." },
        timezone: TZ_SCHEMA,
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: async (args, { userId, origin }) => {
      const tz = safeTz(args.timezone);
      const start = typeof args.date === "string" && DAY_RE.test(args.date) ? args.date : localDay(new Date(), tz);
      const count = Math.min(7, Math.max(1, Math.round(numArg(args.days)) || 1));
      const days = Array.from({ length: count }, (_, i) => addDays(start, i));
      const asked = Array.isArray(args.slots) ? MENU_SLOTS.filter((s) => (args.slots as unknown[]).includes(s)) : [];
      const slots = asked.length ? asked : MENU_SLOTS;

      // Ціль, названа вголос, — саме на ці прийоми; ні — денна з налаштувань, частка цих прийомів.
      const said: MenuTargets = {};
      for (const k of ["kcal", "protein", "fat", "carbs"] as const) {
        const v = numArg(args[k]);
        if (v > 0) said[k] = v;
      }
      const goals = await goalsOf(userId);
      const target = hasTarget(said) ? said : scaleTargets(goals.targets, slotShare(slots));
      if (!hasTarget(target)) {
        return fail(
          "Ціль не задана. Скажи, скільки калорій і білка на день, або задай цілі в Ням → Налаштування → Щоденник.",
        );
      }

      const family = await familyOf(userId);
      const { data: planned, error: planError } = await db()
        .from("plan_slots")
        .select("day,slot,recipe_id")
        .in("user_id", family)
        .gte("day", days[0])
        .lte("day", days[days.length - 1]);
      if (planError) return fail("План зараз не відповідає — спробуй ще раз.");
      const keep = args.replace === true ? [] : (planned ?? []).filter((r) => slots.includes(r.slot as PlanSlot));
      const recipes = await menuRecipes(userId, family, keep.map((r) => String(r.recipe_id)));
      if (!recipes) return fail("Рецепти зараз не відповідають — спробуй ще раз.");
      if (!recipes.candidates.some((d) => d.perServing && d.slots.length)) {
        return fail("Немає рецептів із порахованими калоріями — додай рецепти в Ням.");
      }

      const kept: Record<string, Partial<Record<PlanSlot, MenuDish>>> = {};
      for (const r of keep) {
        const id = String(r.recipe_id);
        const dish = recipes.dishes.get(id) ?? { id, title: "страва з плану", emoji: "🍽️", slots: [] };
        (kept[String(r.day)] ??= {})[r.slot as PlanSlot] ??= dish;
      }
      const menu = planMenu({
        dishes: recipes.candidates,
        days,
        slots,
        target,
        appetite: goals.appetite,
        kept,
        variant: Math.max(0, Math.round(numArg(args.variant)) || 0),
      });

      let saved = 0;
      if (args.save === true) {
        const rows = menu.flatMap((d) =>
          d.picks.filter((p) => !p.kept).map((p) => ({ user_id: userId, day: d.day, slot: p.slot, recipe_id: p.dish.id })),
        );
        if (rows.length) {
          // Слот плану один на сімʼю, як у застосунку (setPlanSlot): чужий запис на той самий прийом прибираємо.
          const others = family.filter((id) => id !== userId);
          if (others.length) {
            const { error } = await db()
              .from("plan_slots")
              .delete()
              .in("user_id", others)
              .or(rows.map((r) => `and(day.eq.${r.day},slot.eq.${r.slot})`).join(","));
            if (error) return fail("Не вдалося записати меню в план — спробуй ще раз.");
          }
          const { error } = await db().from("plan_slots").upsert(rows, { onConflict: "user_id,day,slot" });
          if (error) return fail("Не вдалося записати меню в план — спробуй ще раз.");
        }
        saved = rows.length;
      }

      const lines =
        menu.length === 1
          ? [
              `Меню на ${dayName(menu[0].day)}, ціль ${targetLine(menu[0].target)}:`,
              ...menu[0].picks.map(
                (p) => `${SLOT_META[p.slot].label}: ${pickLine(p)} — ${menuNutrition(p.nutrition)}.`,
              ),
              `Разом: ${menuNutrition(menu[0].total)}.`,
            ]
          : [
              `Меню на ${menu.length} днів (${dayName(days[0])} — ${dayName(days[days.length - 1])}), ціль на день ${targetLine(target)}:`,
              ...menu.map(
                (d) =>
                  `${dayName(d.day)}: ${d.picks
                    .map((p) => `${SLOT_META[p.slot].label.toLowerCase()} — ${pickLine(p)}`)
                    .join("; ")}. Разом ${menuNutrition(d.total)}.`,
              ),
              `У середньому за день: ${menuNutrition(
                scaleNutrition(
                  menu.reduce((sum, d) => addNutrition(sum, d.total), ZERO),
                  1 / menu.length,
                ),
              )}.`,
            ];
      const empty = MENU_SLOTS.filter((s) => menu.some((d) => d.empty.includes(s)));
      if (empty.length) {
        lines.push(
          `${empty.map((s) => SLOT_META[s].label).join(", ")}: немає рецептів із порахованими калоріями — ціль дня зменшено на цю частку.`,
        );
      }
      const openUrl = saved ? `${origin}/plan` : null;
      if (args.save !== true) lines.push("Це пропозиція — у план ще не записано.");
      else if (saved) lines.push(`Записав у план на тиждень (${saved} ${plural(saved, "страва", "страви", "страв")}); порцій план не зберігає.`);
      else lines.push("Нового в план записувати нічого — усе вже заплановано.");
      if (openUrl) lines.push(`План (відкрий людині, вголос не читай): ${openUrl}`);

      return text(lines.join("\n"), {
        target,
        days: menu.map((d) => ({
          day: d.day,
          target: d.target,
          total: d.total,
          empty: d.empty,
          picks: d.picks.map((p) => ({
            slot: p.slot,
            recipe_id: p.dish.id,
            title: p.dish.title,
            portions: p.portions,
            nutrition: p.nutrition ?? null,
            kept: p.kept,
          })),
        })),
        saved,
        open_url: openUrl,
      });
    },
  },

  {
    name: "list_pantry",
    title: "Що в коморі",
    description: "Що зараз лежить у коморі (холодильнику) сімʼї: назви, кількості, строки придатності.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (_args, { userId }) => {
      const family = await familyOf(userId);
      const { data, error } = await db()
        .from("pantry_items")
        .select("ingredient_key,product_id,label,amount,unit,expires_at")
        .in("user_id", family)
        .order("added_at", { ascending: false })
        .limit(150);
      if (error) return fail("Комора зараз не відповідає.");
      const rows = data ?? [];
      if (rows.length === 0) return text("Комора порожня.", { items: [] });
      const ids = [...new Set(rows.map((r) => r.product_id).filter(Boolean) as string[])];
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: cards } = await db().from("products").select("id,name").in("id", ids);
        for (const c of cards ?? []) names.set(String(c.id), String(c.name));
      }
      const items = rows.map((r) => {
        const key = String(r.ingredient_key);
        const name = (r.product_id && names.get(String(r.product_id))) || (r.label as string | null) || ing(key).label;
        const qty = r.amount != null && r.unit ? formatQuantity(Number(r.amount), r.unit as Unit) : "";
        return { name, qty, expires: (r.expires_at as string | null) ?? null };
      });
      return text(
        items.map((i) => [i.name, i.qty, i.expires ? `до ${i.expires}` : ""].filter(Boolean).join(" · ")).join("\n"),
        { items },
      );
    },
  },

  {
    name: "delete_food_entry",
    title: "Прибрати запис щоденника",
    description:
      "Прибирає помилковий запис щоденника за id (з відповіді log_product, log_dish чи get_diary). " +
      "Те, що запис списав із комори, повертається туди.",
    inputSchema: {
      type: "object",
      properties: { entry_id: { type: "string" } },
      required: ["entry_id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    run: async (args, { userId }) => {
      const id = str(args.entry_id, 40);
      if (!UUID_RE.test(id)) return fail("Невідомий id запису.");
      const { data, error } = await db()
        .from("food_log")
        .delete()
        .eq("id", id)
        .or(`user_id.eq.${userId},logged_by.eq.${userId}`)
        .select("title,meal_id,source,pantry_taken");
      if (error) return fail("Не вдалося прибрати — спробуй ще раз.");
      const entry = data?.[0];
      if (!entry) return fail("Такого запису немає у твоєму щоденнику.");

      const back = parsePantryTaken(entry.pantry_taken) ?? [];
      /*
       * Страва, описана словами, без жодного запису — помилка, а не залишок
       * (як у застосунку): прибираємо й її, а взяте нею з комори повертаємо.
       * Приготований рецепт лишається залишком.
       */
      if (entry.meal_id && (entry.source === "voice" || entry.source === "dish")) {
        const { count } = await db()
          .from("food_log")
          .select("id", { count: "exact", head: true })
          .eq("meal_id", entry.meal_id);
        if (count === 0) {
          const family = await familyOf(userId);
          const { data: meals } = await db()
            .from("meals")
            .delete()
            .eq("id", entry.meal_id)
            .in("user_id", family)
            .select("pantry_taken");
          back.push(...(parsePantryTaken(meals?.[0]?.pantry_taken) ?? []));
        }
      }
      const returned = await giveBack(userId, back);
      return text(
        `Прибрано: ${entry.title}.${returned.length ? ` Повернув у комору: ${returned.join(", ")}.` : ""}`,
        { ok: true, returned },
      );
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
