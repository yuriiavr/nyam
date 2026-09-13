import { ing, satisfies } from "@/data/ingredients";
import { ingredientGrams } from "./nutrition";
import { consumptionOrder, rowGrams, type ProductCache } from "./pantry";
import type { Product } from "./product-types";
import type { PantryItem, Recipe } from "./types";
import { quantityOf } from "./units";

/**
 * Скільки страва коштувала насправді.
 *
 * Не рівень «дешево / дорого», який автор рецепта проставив на око, а гривні
 * з чеків: сканер чека знає, скільки коштував кілограм цієї курки саме в
 * тому магазині й саме того дня. Далі лишається арифметика, яку застосунок
 * уже вміє для калорій — звести все до грамів і помножити.
 *
 * Ціни в кожного свої, тож і число своє: рецепт зі спільної стрічки покаже
 * рівно те, у скільки він обійдеться тобі, а не автору.
 */

export interface RecipeCost {
  /** Уся страва, грн. */
  total: number;
  /** Одна порція, грн. */
  perServing: number;
  /** Частка інгредієнтів (0..1), для яких відома ціна. */
  coverage: number;
  /** Найдорожчі складові — щоб було видно, за що саме платиш. */
  top: Array<{ key: string; label: string; cost: number }>;
}

/**
 * Ціна за грам продукту з комори.
 *
 * Через грам, бо це спільний знаменник для всього: рецепт просить склянку,
 * чек рахував кілограми, а на упаковці стояли мілілітри. Ту саму дорогу вже
 * протоптав підрахунок калорій, тож користуємось нею.
 */
export function pricePerGram(item: PantryItem): number | null {
  if (item.pricePerGram == null || !(item.pricePerGram > 0)) return null;
  return item.pricePerGram;
}

/**
 * Ціна за грам із покупки: скільки заплатили за скільки продукту.
 *
 * Грами — через rowGrams (D10): з карткою товару «2 шт» пачки 900 мл — це
 * 1800 г, а не вага «середньої штуки молока»; без картки — через тип і його
 * предків, як і в рецептах.
 */
export function priceFromPurchase(
  key: string,
  amount: number | undefined,
  unit: PantryItem["unit"],
  paid: number | undefined,
  product?: Product,
): number | null {
  if (amount == null || !unit || paid == null || paid <= 0) return null;
  const grams = rowGrams(
    { id: "", key: product?.typeKey ?? key, amount, unit, addedAt: "", productId: product?.id },
    product ? { [product.id]: product } : undefined,
  );
  if (grams == null || grams <= 0) return null;

  const perGram = paid / grams;
  // Захист від абсурду: понад 100 000 грн за кілограм — це не продукт, а
  // помилка розбору. Краще не показати ціну, ніж показати вигадану.
  return perGram > 0 && perGram < 100 ? perGram : null;
}

/**
 * Ціна грама для потреби рецепта.
 *
 * Годиться і сам тип, і різновид: безлактозне молоко з чека оцінює рецепт із
 * «Молоко». Беремо той рядок, який списання взяло б першим (точний тип, далі
 * найближчий строк), — страва коштує стільки, скільки те, що в неї піде. Якщо
 * такого з кількістю немає, — середнє за грамами серед рядків із ціною.
 */
function priceFor(needKey: string, priced: PantryItem[], products: ProductCache): number | null {
  const fitting = priced.filter((row) => satisfies(row.key, needKey));
  if (fitting.length === 0) return null;
  const first = consumptionOrder(needKey, fitting, products)[0];
  if (first) return pricePerGram(first);

  let grams = 0;
  let sum = 0;
  for (const row of fitting) {
    const weight = rowGrams(row, products) ?? 1;
    grams += weight;
    sum += (pricePerGram(row) as number) * weight;
  }
  return grams > 0 ? sum / grams : null;
}

/**
 * `products` — кеш карток зі стору: з ним штучні рядки товару важать як
 * пачка, а не як «середня штука» типу. Без нього рахуємо за типом.
 */
export function recipeCost(recipe: Recipe, pantry: PantryItem[], products: ProductCache = {}): RecipeCost | null {
  const priced = pantry.filter((item) => pricePerGram(item) != null);
  if (priced.length === 0) return null;

  const parts: Array<{ key: string; label: string; cost: number }> = [];
  let considered = 0;
  let usable = 0;

  for (const item of recipe.ingredients) {
    const def = ing(item.key);
    const q = quantityOf(item);
    // «За смаком» не зважити, а отже й не оцінити — з покриття виключаємо,
    // інакше дрібка солі знецінювала б довіру до всього числа.
    const negligible = q?.unit === "taste";
    if (!negligible) considered += 1;

    const price = priceFor(item.key, priced, products);
    const grams = ingredientGrams(item);
    if (price == null || grams == null) continue;

    parts.push({ key: item.key, label: item.label ?? def.label, cost: price * grams });
    if (!negligible) usable += 1;
  }

  if (usable === 0) return null;

  const total = parts.reduce((sum, p) => sum + p.cost, 0);
  const servings = Math.max(1, recipe.servings || 1);

  return {
    total: Math.round(total * 100) / 100,
    perServing: Math.round((total / servings) * 100) / 100,
    coverage: considered === 0 ? 1 : Math.min(1, usable / considered),
    top: parts
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 3)
      .map((p) => ({ ...p, cost: Math.round(p.cost * 100) / 100 })),
  };
}
