import { ing } from "@/data/ingredients";
import { ingredientGrams } from "./nutrition";
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

/** Ціна за грам із покупки: скільки заплатили за скільки продукту. */
export function priceFromPurchase(
  key: string,
  amount: number | undefined,
  unit: PantryItem["unit"],
  paid: number | undefined,
): number | null {
  if (amount == null || !unit || paid == null || paid <= 0) return null;
  const grams = ingredientGrams({ key, amount, unit });
  if (grams == null || grams <= 0) return null;

  const perGram = paid / grams;
  // Захист від абсурду: понад 100 000 грн за кілограм — це не продукт, а
  // помилка розбору. Краще не показати ціну, ніж показати вигадану.
  return perGram > 0 && perGram < 100 ? perGram : null;
}

export function recipeCost(recipe: Recipe, pantry: PantryItem[]): RecipeCost | null {
  const prices = new Map<string, number>();
  for (const item of pantry) {
    const price = pricePerGram(item);
    if (price != null) prices.set(item.key, price);
  }
  if (prices.size === 0) return null;

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

    const price = prices.get(item.key);
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
