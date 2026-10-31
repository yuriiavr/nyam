import {
  RESTAURANTS,
  type Restaurant,
  type RestaurantDish,
  type RestaurantId,
  type RestaurantMenu,
} from "@/data/restaurants";
import { roundNutrition } from "./diary";
import type { Nutrition } from "./types";
import { formatNumber } from "./units";

/**
 * Страви із закладів у щоденнику.
 *
 * Запис страви — звичайний FoodEntry: назва, порції в грамах і КБЖВ уже
 * помножені, тож базі нічого нового не треба. Звʼязок зі стравою — через
 * `productId`: туди пишемо сталий UUID страви (з ключа закладу й страви).
 * Колонка product_id без FK, а товарів із таким id немає й не буде: це
 * UUID версії 8, а товари й записи мають версію 4. З нього ж синхронно
 * видно заклад — перші 8 знаків. Так щоденник показує «McDonald's · 2
 * порції» і дає правити запис порціями, а не грамами.
 *
 * Модуль чистий: перевіряється scripts/check-restaurants.mjs.
 */

/** 128 біт із рядка (cyrb128): сталий і синхронний — без crypto.subtle. */
function hash128(text: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
}

const tags = new Map<RestaurantId, string>();

/** Перші 8 знаків id кожної страви закладу. */
export function restaurantTag(id: RestaurantId): string {
  let tag = tags.get(id);
  if (!tag) {
    tag = hash128(`nyam:restaurant:${id}`).slice(0, 8);
    tags.set(id, tag);
  }
  return tag;
}

/** Сталий UUID (версія 8) страви: той самий заклад і ключ — той самий id. */
export function dishId(restaurant: RestaurantId, key: string): string {
  const h = hash128(`nyam:restaurant:${restaurant}:${key}`);
  const variant = ((parseInt(h[7], 16) & 0x3) | 0x8).toString(16);
  return `${restaurantTag(restaurant)}-${h.slice(0, 4)}-8${h.slice(4, 7)}-${variant}${h.slice(8, 11)}-${h.slice(11, 23)}`;
}

/** Заклад запису щоденника — за id страви в productId. Товар чи страва вдома — undefined. */
export function restaurantOfProductId(productId?: string): Restaurant | undefined {
  if (!productId || productId[14] !== "8") return undefined;
  return RESTAURANTS.find((r) => productId.startsWith(`${restaurantTag(r.id)}-`));
}

const byId = new WeakMap<RestaurantMenu, Map<string, RestaurantDish>>();

/** Страва за id запису — у вже завантаженому меню. */
export function dishById(menu: RestaurantMenu, restaurant: RestaurantId, productId: string): RestaurantDish | undefined {
  let index = byId.get(menu);
  if (!index) {
    index = new Map(menu.categories.flatMap((c) => c.dishes.map((d) => [dishId(restaurant, d.key), d] as const)));
    byId.set(menu, index);
  }
  return index.get(productId);
}

/** Емодзі розділу, до якого належить страва. */
export function dishEmoji(menu: RestaurantMenu, dish: RestaurantDish): string {
  return menu.categories.find((c) => c.dishes.includes(dish))?.emoji ?? "🍽️";
}

/**
 * Зʼїдене: порція × кількість. Б/Ж/В, яких заклад не публікує, — нулі: так
 * щоденник і так читає порожні колонки бази; що їх немає, людина бачить при
 * виборі страви.
 */
export function dishNutrition(dish: RestaurantDish, portions: number): Nutrition {
  return roundNutrition({
    kcal: dish.kcal * portions,
    protein: (dish.protein ?? 0) * portions,
    fat: (dish.fat ?? 0) * portions,
    carbs: (dish.carbs ?? 0) * portions,
  });
}

/**
 * Найбільше порцій в одному записі: 20, але не більше, ніж пропустить база
 * (grams ≤ 10 000, kcal ≤ 20 000 у food_log) — бакет на 12 ніжок важить кіло.
 */
export function maxPortions(dish: RestaurantDish): number {
  const byGrams = dish.amount ? 10000 / dish.amount : Infinity;
  const byKcal = dish.kcal > 0 ? 20000 / dish.kcal : Infinity;
  return Math.max(0.5, Math.floor(Math.min(20, byGrams, byKcal) * 2) / 2);
}

/** Грами чи мілілітри зʼїденого — коли вага порції відома. */
export function dishGrams(dish: RestaurantDish, portions: number): number | undefined {
  return dish.amount ? Math.round(dish.amount * portions * 10) / 10 : undefined;
}

/** Скільки порцій у записі: з грамів, а без ваги — з калорій. */
export function portionsOfEntry(dish: RestaurantDish, entry: { grams?: number; nutrition?: Nutrition }): number {
  const raw =
    dish.amount && entry.grams
      ? entry.grams / dish.amount
      : dish.kcal > 0 && entry.nutrition
        ? entry.nutrition.kcal / dish.kcal
        : 1;
  // Порції — з кроком 0,5: дріб від округлень не має вилазити в підпис.
  return Math.min(maxPortions(dish), Math.max(0.5, Math.round(raw * 2) / 2));
}

/** «212 г», «500 мл». */
export function amountLabel(dish: RestaurantDish, portions = 1): string {
  if (!dish.amount) return "";
  return `${formatNumber(dish.amount * portions, 0)} ${dish.unit === "ml" ? "мл" : "г"}`;
}

/** Літери для пошуку: без регістру, апострофів і лапок. */
function fold(text: string): string {
  return text
    .toLocaleLowerCase("uk")
    .replace(/[ʼ’'`"«»“”]/g, "")
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** Чи підходить страва під запит: усі слова запиту є в назві. */
export function dishMatches(dish: RestaurantDish, query: string): boolean {
  const words = fold(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const name = fold(dish.name);
  return words.every((w) => name.includes(w));
}

/** Меню з лише тими стравами, що підходять під запит; порожні розділи — геть. */
export function filterMenu(menu: RestaurantMenu, query: string): RestaurantMenu {
  if (!fold(query)) return menu;
  return {
    categories: menu.categories
      .map((c) => ({ ...c, dishes: c.dishes.filter((d) => dishMatches(d, query)) }))
      .filter((c) => c.dishes.length > 0),
  };
}

/** Чи сходяться ккал із Б/Ж/В: 4·Б + 9·Ж + 4·В в межах ±20 % і ще 15 ккал на округлення. */
export function macrosAgree(dish: Pick<RestaurantDish, "kcal" | "protein" | "fat" | "carbs">): boolean {
  if (dish.protein == null || dish.fat == null || dish.carbs == null) return true;
  const est = 4 * dish.protein + 9 * dish.fat + 4 * dish.carbs;
  return Math.abs(est - dish.kcal) <= 0.2 * dish.kcal + 15;
}
