import { ing, satisfies } from "@/data/ingredients";
import { consumptionOrder, isBareStaple, type ProductCache } from "./pantry";
import type { PantryItem, Recipe, RecipeIngredient, Unit } from "./types";

/**
 * Склад страви, як її справді зварили: що зважили на ходу й з яких пачок.
 *
 * Модуль чистий — його ділять сторінка готування, аркуш ваги й аркуш складу,
 * а перевіряє scripts/check-diary.mjs.
 */

/** Що зважили посеред готування: «огірок — 50 г». */
export interface CookWeight {
  amount: number;
  unit: Unit;
  /** Зважено готовим: варені макарони, запечене мʼясо. */
  cooked?: boolean;
  /** Пачка з комори, з якої брали. */
  rowId?: string;
}

/** Крупи, паста, мʼясо й риба: їх зважують і сухими, і вже готовими. */
const WEIGH_COOKED = new Set(["grain", "meat", "fish"]);

export const weighsCooked = (key: string): boolean => WEIGH_COOKED.has(ing(key).cat);

/** «сухого» для круп і пасти, «сирого» для мʼяса й риби — як кажуть про вагу до готування. */
export const rawWord = (key: string): string => (ing(key).cat === "grain" ? "сухого" : "сирого");

/** Рядки комори, з яких міг піти продукт: спершу ті, з яких бере рецепт, далі — без кількості. */
export function pantryCandidates(view: readonly PantryItem[], key: string, products: ProductCache): PantryItem[] {
  const fit = view.filter((row) => satisfies(row.key, key) && !isBareStaple(row));
  const ordered = consumptionOrder(key, [...fit], products);
  return [...ordered, ...fit.filter((row) => !ordered.includes(row))];
}

/**
 * Пачка, яку пропонуємо першою: товар із рецепта, інакше та, з якої бере
 * рецепт. Необовʼязкове й «за смаком» рецепт не списує — і тут вони не з
 * комори, поки не обереш. Пачку без кількості пропонуємо теж: списати з неї
 * нічого, але етикетка — її.
 */
export function defaultRow(
  item: Pick<RecipeIngredient, "productId" | "optional">,
  rows: readonly PantryItem[],
  unit?: Unit,
): PantryItem | undefined {
  const own = item.productId ? rows.find((row) => row.productId === item.productId) : undefined;
  if (own) return own;
  return item.optional || unit === "taste" ? undefined : rows[0];
}

/**
 * Основа слова для пошуку в тексті кроку: «огірок» знаходить «огірки» й
 * «огірка», «морква» — «моркву». Відкидаємо закінчення, а не шукаємо ціле
 * слово: кроки пишуть у всіх відмінках. Коротке слово лишаємо як є.
 */
function stem(word: string): string {
  if (word.length >= 6) return word.slice(0, -2);
  if (word.length >= 4) return word.slice(0, -1);
  return word;
}

const WORD = /[\p{L}ʼ']+/gu;

/**
 * Які продукти згадує крок: «Наріж огірки й помідори кубиками» → огірок,
 * помідор. Щоб зважити саме їх одним дотиком, а не шукати в усьому списку.
 * Шукаємо з початку слова — «сир» не знаходиться в «посипати», — за назвою
 * з рецепта, типом і синонімами. Порядок — як у рецепті.
 */
export function stepIngredients(recipe: Pick<Recipe, "ingredients" | "steps">, step: number): RecipeIngredient[] {
  const text = recipe.steps[step]?.text?.toLowerCase() ?? "";
  if (!text) return [];
  const words = text.match(WORD) ?? [];
  const seen = new Set<string>();

  return recipe.ingredients.filter((item) => {
    if (seen.has(item.key)) return false;
    const def = ing(item.key);
    const names = [item.label, def.label, ...(def.aliases ?? [])].filter((n): n is string => !!n);
    const own = names.flatMap((n) => (n.toLowerCase().match(WORD) ?? []).filter((w) => w.length >= 3));
    // Коротке слово — лише з коротким закінченням: «сиром», але не «сирники»; «том» (ям) — не «томати».
    const hit = own.some((name) => {
      const s = stem(name);
      return words.some((w) => w.startsWith(s) && (name.length > 3 || w.length <= name.length + 2));
    });
    if (hit) seen.add(item.key);
    return hit;
  });
}

/**
 * Рецепт із вагами, записаними на ходу, — щоб після «Готово!» комора
 * списалась за ними, а не за рецептом. Зважене готовим лишається з мірою
 * рецепта: скільки сухого на нього пішло, скаже лише ШІ, і тоді аркуш складу
 * перепише списання точно.
 */
export function withWeights(recipe: Recipe, weights: Readonly<Record<string, CookWeight>>): Recipe {
  if (Object.keys(weights).length === 0) return recipe;
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((item) => {
      const w = weights[item.key];
      return w && !w.cooked ? { ...item, amount: w.amount, unit: w.unit, optional: false } : item;
    }),
  };
}
