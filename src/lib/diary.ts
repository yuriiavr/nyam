import { ing, knownIngredient } from "@/data/ingredients";
import { recipeNutrition } from "./nutrition";
import type { Product } from "./product-types";
import type { CookEvent, DiarySettings, FoodEntry, Meal, MealItem, MealSlot, Nutrition, Recipe } from "./types";
import { formatNumber } from "./units";
import { dateKey, plural } from "./utils";

/**
 * Щоденник харчування: хто що зʼїв і скільки це калорій.
 *
 * Два види записів. Товар — батончик зі сканера чи йогурт із пошуку: грами ×
 * етикетка на 100 г. Частка страви — казан, зварений на кількох: страва знає
 * своє КБЖВ і скільки вийшло порцій, а кожен запис — яку частку зʼїла саме ця
 * людина. Так «я зʼїв більше за дівчину» стає просто двома різними частками
 * однієї страви, а що лишилось у каструлі, видно без жодного обліку.
 *
 * Модуль чистий: ні стору, ні мережі. Тому перевіряється scripts/check-diary.mjs.
 */

export const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export const SLOT_META: Record<MealSlot, { label: string; emoji: string }> = {
  breakfast: { label: "Сніданок", emoji: "🍳" },
  lunch: { label: "Обід", emoji: "🍲" },
  dinner: { label: "Вечеря", emoji: "🍽️" },
  snack: { label: "Перекус", emoji: "🍫" },
};

/** Прийом їжі за годиною — той самий поділ, що й currentMeal у utils. */
export function slotAt(date: Date = new Date()): MealSlot {
  const h = date.getHours();
  if (h >= 5 && h < 11) return "breakfast";
  if (h >= 11 && h < 16) return "lunch";
  if (h >= 16 && h < 22) return "dinner";
  return "snack";
}

/** Типова година прийому — для запису «вчорашнього обіду», зробленого сьогодні. */
const SLOT_HOUR: Record<MealSlot, number> = { breakfast: 8, lunch: 13, dinner: 19, snack: 16 };

/**
 * Коли зʼїли: сьогодні — просто зараз; інший день — типова година прийому.
 * Інакше обід, дописаний увечері за вчора, ліг би на вчорашню ніч.
 */
export function eatenAtFor(day: string, slot: MealSlot, now: Date = new Date()): string {
  if (day === dateKey(now)) return now.toISOString();
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, SLOT_HOUR[slot], 0).toISOString();
}

export const ZERO: Nutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

export function addNutrition(a: Nutrition, b: Nutrition): Nutrition {
  return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, fat: a.fat + b.fat, carbs: a.carbs + b.carbs };
}

export function scaleNutrition(n: Nutrition, factor: number): Nutrition {
  return { kcal: n.kcal * factor, protein: n.protein * factor, fat: n.fat * factor, carbs: n.carbs * factor };
}

/** Ккал — цілими, БЖВ — з десятою: так їх і показуємо, і пишемо в базу. */
export function roundNutrition(n: Nutrition): Nutrition {
  const tenth = (x: number) => Math.round(x * 10) / 10;
  return { kcal: Math.round(n.kcal), protein: tenth(n.protein), fat: tenth(n.fat), carbs: tenth(n.carbs) };
}

/** КБЖВ зʼїденої кількості з етикетки на 100 г. */
export function forGrams(per100: Nutrition, grams: number): Nutrition {
  return roundNutrition(scaleNutrition(per100, grams / 100));
}

/* ── Страва ───────────────────────────────────────────────────────────── */

/** КБЖВ страви — сума її складу. */
export function itemsNutrition(items: readonly MealItem[]): Nutrition {
  return roundNutrition(items.reduce<Nutrition>((sum, item) => addNutrition(sum, item), ZERO));
}

/**
 * КБЖВ усієї страви, якому вірити зараз.
 *
 * Для рецепта — свіже з самого рецепта, помножене на те, скільки порцій
 * справді зварили: число ШІ приходить через хвилину після збереження, і
 * страва, записана в цю хвилину, без цього лишилась би з грубою оцінкою
 * довідника назавжди. Немає рецепта (приватний, видалений) — що записали.
 */
export function mealNutrition(meal: Meal, recipe?: Recipe | null): Nutrition | undefined {
  if (recipe && meal.recipeId === recipe.id) {
    const n = recipeNutrition(recipe);
    if (n && (n.source === "ai" || n.coverage >= 0.5 || !meal.nutrition)) {
      return roundNutrition(scaleNutrition(n.total, meal.servings / Math.max(1, recipe.servings || 1)));
    }
  }
  return meal.nutrition;
}

/** Страва з рецепта: КБЖВ на скільки порцій її зварили. */
export function recipeMealNutrition(recipe: Recipe, servings: number): Nutrition | undefined {
  const n = recipeNutrition(recipe);
  if (!n) return undefined;
  return roundNutrition(scaleNutrition(n.total, servings / Math.max(1, recipe.servings || 1)));
}

/** Страва з приготованого рецепта — ще без записів, ділити її вирішить людина. */
export function mealFromRecipe(
  recipe: Recipe,
  opts: { id: string; ownerId: string; cookedAt: string; servings?: number },
): Meal {
  const servings = Math.max(1, opts.servings ?? recipe.servings ?? 1);
  return {
    id: opts.id,
    ownerId: opts.ownerId,
    recipeId: recipe.id,
    title: recipe.title,
    emoji: recipe.emoji,
    servings,
    nutrition: recipeMealNutrition(recipe, servings),
    items: [],
    cookedAt: opts.cookedAt,
    eaten: 0,
    finished: false,
  };
}

/**
 * Скільки страви вже зʼїли (0..1).
 *
 * База рахує всі записи, і ті, яких цей телефон не бачить (приватний
 * щоденник дівчини). Але щойно зроблений запис долетить до неї за секунду —
 * тому беремо більше з двох: її число й те, що видно тут.
 */
export function mealEaten(meal: Meal, entries: readonly FoodEntry[]): number {
  const local = entries.reduce((sum, e) => (e.mealId === meal.id && e.share ? sum + e.share : sum), 0);
  return Math.min(1, Math.max(meal.eaten, local));
}

/** Скільки порцій лишилось. Крихти (менше десятої порції) — не залишок. */
export function leftoverServings(meal: Meal, entries: readonly FoodEntry[]): number {
  if (meal.finished) return 0;
  const left = meal.servings * (1 - mealEaten(meal, entries));
  return left >= 0.1 ? Math.round(left * 100) / 100 : 0;
}

/** Залишки, які ще варто пропонувати: свіжі (до трьох діб), незакриті, найновіші першими. */
export function leftovers(meals: readonly Meal[], entries: readonly FoodEntry[], now = new Date()): Meal[] {
  const horizon = now.getTime() - 3 * 24 * 3600_000;
  return meals
    .filter((m) => new Date(m.cookedAt).getTime() >= horizon && leftoverServings(m, entries) > 0)
    .sort((a, b) => b.cookedAt.localeCompare(a.cookedAt));
}

/* ── Хто скільки зʼїв ─────────────────────────────────────────────────── */

export interface Eater {
  userId: string;
  appetite: number;
}

/**
 * Пропозиція, хто скільки порцій зʼїв: кожному — порція за його апетитом.
 *
 * «Порція» тут — порція рецепта. Апетит 1,5 — півтори такі порції. Якщо на
 * всіх не вистачає (зварили дві порції, а апетитів на дві з половиною), ділимо
 * пропорційно: казан порожній, але хто їсть більше, той і отримав більше.
 * Інакше лишається залишок — і це правда: на чотири порції двоє зазвичай не
 * зʼїдають усе. Округлюємо до чверті: ніхто не каже «зʼїв 1,37 порції».
 */
export function splitDefaults(eaters: readonly Eater[], servings: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (eaters.length === 0 || servings <= 0) return out;
  const want = eaters.map((e) => Math.max(0.25, e.appetite || 1));
  const total = want.reduce((a, b) => a + b, 0);
  const factor = total > servings ? servings / total : 1;
  eaters.forEach((e, i) => {
    out[e.userId] = Math.max(0.25, Math.round(want[i] * factor * 4) / 4);
  });

  // Округлення не має вилізти за казан: зайве знімаємо з того, у кого найбільше.
  let over = Object.values(out).reduce((a, b) => a + b, 0) - servings;
  while (over > 1e-9) {
    const top = Object.entries(out).sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] <= 0.25) break;
    out[top[0]] = top[1] - 0.25;
    over -= 0.25;
  }
  return out;
}

/** Порції → частки страви для записів: «1,5 з 4 порцій» — це 0,375 страви. */
export function sharesFromPortions(portions: Record<string, number>, servings: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [userId, p] of Object.entries(portions)) {
    if (p > 0) out[userId] = Math.min(1, Math.round((p / servings) * 1000) / 1000);
  }
  return out;
}

/** Грами з ваг → порції: «уся страва 1200 г, моя тарілка 450 г». */
export function portionsFromGrams(plate: number, dishGrams: number, servings: number): number {
  if (!(dishGrams > 0) || !(plate > 0)) return 0;
  return Math.round((plate / dishGrams) * servings * 100) / 100;
}

/** «1 порція», «1,5 порції», «2 порції», «5 порцій». */
export function portionLabel(n: number): string {
  const text = formatNumber(n, 2);
  if (!Number.isInteger(n)) return `${text} порції`;
  return `${text} ${plural(n, "порція", "порції", "порцій")}`;
}

/* ── Записи ───────────────────────────────────────────────────────────── */

/**
 * КБЖВ одного запису. Частка страви — від свіжого КБЖВ страви (рецепт міг
 * дорахуватись), інакше — те, що записали.
 */
export function entryNutrition(
  entry: FoodEntry,
  mealOf: (id: string) => Meal | undefined,
  recipeOf: (id: string) => Recipe | undefined,
): Nutrition | undefined {
  if (entry.mealId && entry.share) {
    const meal = mealOf(entry.mealId);
    if (meal) {
      const total = mealNutrition(meal, meal.recipeId ? recipeOf(meal.recipeId) : undefined);
      if (total) return roundNutrition(scaleNutrition(total, entry.share));
    }
  }
  return entry.nutrition;
}

export interface DayTotals extends Nutrition {
  entries: number;
  /** Записи без КБЖВ — показуємо чесно, а не тихо рахуємо нулем. */
  unknown: number;
}

export function sumEntries(
  entries: readonly FoodEntry[],
  nutritionOf: (entry: FoodEntry) => Nutrition | undefined,
): DayTotals {
  let total = { ...ZERO };
  let unknown = 0;
  for (const entry of entries) {
    const n = nutritionOf(entry);
    if (n) total = addNutrition(total, n);
    else unknown += 1;
  }
  return { ...roundNutrition(total), entries: entries.length, unknown };
}

/** Записи людини за місцевий день, у порядку часу. */
export function entriesOn(entries: readonly FoodEntry[], userId: string, day: string): FoodEntry[] {
  return entries
    .filter((e) => e.userId === userId && dateKey(new Date(e.eatenAt)) === day)
    .sort((a, b) => a.eatenAt.localeCompare(b.eatenAt));
}

/* ── Підтвердити комору ───────────────────────────────────────────────── */

/**
 * Страви, записані голосом, що чекають «що взяли з комори?».
 *
 * Помічник комору під страву сам не списує: який рядок і скільки грамів —
 * лише здогад ШІ. Питаємо господаря страви два дні; далі вже ніхто не
 * згадає, і тихо пропускаємо.
 */
export function pantryPending(
  meals: readonly Meal[],
  entries: readonly FoodEntry[],
  userId: string,
  now: Date = new Date(),
): Meal[] {
  const since = now.getTime() - 48 * 3600_000;
  return meals.filter(
    (m) =>
      m.ownerId === userId &&
      m.pantryTaken === undefined &&
      !m.finished &&
      new Date(m.cookedAt).getTime() >= since &&
      m.items.some((i) => i.pantryId) &&
      entries.some((e) => e.mealId === m.id && e.source === "voice"),
  );
}

/* ── Готування без запису ─────────────────────────────────────────────── */

/**
 * Готування, яких немає в щоденнику стравами.
 *
 * До щоденника кожне готування рахувалось однією порцією — і так лишається
 * для старих днів, щоб історія не зникла. А свіже (сьогодні й учора)
 * питаємо «хто їв?»: тепер на це є відповідь точніша за «одна порція».
 * Страва впізнається за рецептом і часом — у межах дванадцяти годин.
 */
export function unloggedCooks(
  cooked: readonly CookEvent[],
  meals: readonly Meal[],
): CookEvent[] {
  return cooked.filter((event) => {
    const at = new Date(event.at).getTime();
    return !meals.some(
      (m) => m.recipeId === event.recipeId && Math.abs(new Date(m.cookedAt).getTime() - at) < 12 * 3600_000,
    );
  });
}

export function isFreshCook(event: CookEvent, now = new Date()): boolean {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return new Date(event.at).getTime() >= yesterday.getTime();
}

/* ── Товар ────────────────────────────────────────────────────────────── */

/** Грами в упаковці: мл рахуємо як грами (для напоїв і молока похибка мізерна). */
export function packGrams(product: Pick<Product, "packAmount" | "packUnit" | "gramsPerPiece">): number | null {
  const { packAmount, packUnit } = product;
  if (packAmount == null || !packUnit) return null;
  switch (packUnit) {
    case "g":
    case "ml":
      return packAmount;
    case "kg":
    case "l":
      return packAmount * 1000;
    case "pcs":
      return product.gramsPerPiece ? packAmount * product.gramsPerPiece : null;
  }
}

export interface PortionPreset {
  kind: "piece" | "pieces" | "pack" | "half" | "hundred";
  label: string;
  grams: number;
}

/**
 * Швидкі кількості для товару: батончик — «уся пачка», йогурт — «пів», яйця —
 * «1 шт». Те, що людина справді каже, коли їсть, а не «82 грами».
 */
export function portionPresets(
  product: Pick<Product, "packAmount" | "packUnit" | "gramsPerPiece">,
  fallbackPiece?: number,
): PortionPreset[] {
  const out: PortionPreset[] = [];
  const pack = packGrams(product);
  const piece = product.gramsPerPiece ?? fallbackPiece;
  const unit = product.packUnit === "ml" || product.packUnit === "l" ? "мл" : "г";

  if (piece) out.push({ kind: "piece", label: `1 шт · ${formatNumber(piece, 0)} г`, grams: piece });
  // Десяток яєць цілою «пачкою» не їдять: для штучного товару — штуки.
  if (piece && product.packUnit === "pcs") {
    out.push({ kind: "pieces", label: `2 шт · ${formatNumber(piece * 2, 0)} г`, grams: piece * 2 });
  } else {
    if (pack && pack <= 600 && pack !== piece) {
      out.push({ kind: "pack", label: `Уся пачка · ${formatNumber(pack, 0)} ${unit}`, grams: pack });
    }
    if (pack && pack > 60) out.push({ kind: "half", label: `½ пачки · ${formatNumber(pack / 2, 0)} ${unit}`, grams: pack / 2 });
  }
  if (!out.some((p) => p.grams === 100)) out.push({ kind: "hundred", label: `100 ${unit}`, grams: 100 });
  return out.slice(0, 4);
}

/* ── Склад страви з комори ────────────────────────────────────────────── */

/**
 * КБЖВ одного продукту страви: етикетка товару → довідник типу → оцінка ШІ.
 * Порядок — від точнішого: «не всі сири однакові», тож конкретний сир
 * зі своєю етикеткою завжди перемагає «сир взагалі».
 */
export function mealItem(input: {
  name: string;
  grams: number;
  product?: Product | null;
  typeKey?: string;
  pantryId?: string;
  ai?: Nutrition;
}): MealItem {
  const { product, grams } = input;
  const typeKey = product?.typeKey ?? input.typeKey;
  const label = product?.nutrition && product.nutritionSource !== "ai" ? product.nutrition : undefined;
  const catalog = typeKey && knownIngredient(typeKey) ? ing(typeKey).nutrition : undefined;
  // Оцінка ШІ на картці товару — та сама оцінка, просто вже збережена.
  const aiCard = product?.nutrition && product.nutritionSource === "ai" ? product.nutrition : undefined;

  const [per100, from]: [Nutrition | undefined, MealItem["from"]] = label
    ? [label, "label"]
    : input.ai
      ? [input.ai, "ai"]
      : aiCard
        ? [aiCard, "ai"]
        : catalog
          ? [catalog, "catalog"]
          : [undefined, "ai"];

  const n = per100 ? forGrams(per100, grams) : ZERO;
  return {
    name: input.name,
    grams: Math.round(grams),
    ...(product ? { productId: product.id } : {}),
    ...(typeKey ? { typeKey } : {}),
    ...(input.pantryId ? { pantryId: input.pantryId } : {}),
    ...n,
    from,
  };
}

/**
 * «Нещодавнє» для швидкого повтору: товари, які людина їла, — по одному,
 * найсвіжіші першими, з тією самою вагою, що й минулого разу.
 */
export function recentProducts(
  entries: readonly FoodEntry[],
  userId: string,
  limit = 8,
): Array<{ productId: string; grams?: number; title: string; emoji: string }> {
  const seen = new Set<string>();
  const out: Array<{ productId: string; grams?: number; title: string; emoji: string }> = [];
  const mine = entries.filter((e) => e.userId === userId && e.productId).sort((a, b) => b.eatenAt.localeCompare(a.eatenAt));
  for (const e of mine) {
    const id = e.productId as string;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ productId: id, grams: e.grams, title: e.title, emoji: e.emoji });
    if (out.length >= limit) break;
  }
  return out;
}

/** Налаштування людини, якої ще немає в базі: без цілі, звичайний апетит, щоденник приватний. */
export function settingsOf(list: readonly DiarySettings[], userId: string): DiarySettings {
  return list.find((s) => s.userId === userId) ?? { userId, appetite: 1, shareDiary: false };
}
