import { ing } from "@/data/ingredients";
import type { CookEvent, Nutrition, Recipe, RecipeIngredient, Unit } from "./types";
import { quantityOf, unitDef } from "./units";
import { dateKey } from "./utils";

/**
 * Підрахунок калорій і БЖВ.
 *
 * Рахуємо з інгредієнтів: кожен зводимо до грамів, беремо довідкову цінність
 * на 100 г і складаємо. Це оцінка, а не лабораторний аналіз — вода при варінні
 * випаровується, жир на сковороді лишається в пательні, а «велика цибулина»
 * у всіх різна. Тому поруч завжди показуємо, яку частку складу вдалося
 * порахувати: якщо мало — число оманливе.
 */

/**
 * Скільки грамів у мірі обʼєму, якщо про продукт нічого не відомо.
 * Числа для води: склянка — 240 мл, ложка — 15 мл. Для сипкого це
 * завищення (склянка борошна важить 120 г), тому там, де довідник знає
 * gramsPerCup, беремо його, а сюди падаємо лише як у запасний варіант.
 */
const GRAMS_PER_UNIT: Partial<Record<Unit, number>> = {
  tbsp: 15,
  tsp: 5,
  cup: 240,
  bunch: 30,
  handful: 30,
  pinch: 0.5,
};

/** Ложки — частки склянки: 1 скл. = 16 ст. л. = 48 ч. л. */
const CUP_FRACTION: Partial<Record<Unit, number>> = {
  cup: 1,
  tbsp: 1 / 16,
  tsp: 1 / 48,
};

/** Переводить кількість інгредієнта у грами. null — перевести не вдалося. */
export function ingredientGrams(item: RecipeIngredient): number | null {
  const q = quantityOf(item);
  if (!q || q.amount == null) return null;

  const def = unitDef(q.unit);

  // Вага — напряму.
  if (def.base === "g") return q.amount * def.factor;

  // Обʼєм рахуємо як 1 мл ≈ 1 г. Для води й молока це точно, для олії
  // завищує приблизно на 8% — прийнятна похибка для домашнього обліку.
  if (def.base === "ml") return q.amount * def.factor;

  if (q.unit === "pcs") {
    const perPiece = ing(item.key).gramsPerPiece;
    return perPiece ? q.amount * perPiece : null;
  }

  // Склянки й ложки — за щільністю конкретного продукту, якщо вона відома.
  const fraction = CUP_FRACTION[q.unit];
  const perCup = ing(item.key).gramsPerCup;
  if (fraction != null && perCup) return q.amount * perCup * fraction;

  const grams = GRAMS_PER_UNIT[q.unit];
  return grams ? q.amount * grams : null;
}

export interface RecipeNutrition {
  /** На одну порцію. */
  perServing: Nutrition;
  /** На всю страву. */
  total: Nutrition;
  /** Частка інгредієнтів (0..1), яку вдалося врахувати. */
  coverage: number;
  /** Інгредієнти, які не потрапили в підрахунок — щоб чесно показати. */
  skipped: string[];
}

const ZERO: Nutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0 };

export function recipeNutrition(recipe: Recipe): RecipeNutrition | null {
  const counted: Nutrition = { ...ZERO };
  const skipped: string[] = [];
  let usable = 0;
  let considered = 0;

  for (const item of recipe.ingredients) {
    const def = ing(item.key);
    // Етикетка конкретного товару точніша за довідник по категорії.
    const nut = item.nutrition ?? def.nutrition;
    const grams = ingredientGrams(item);
    const q = quantityOf(item);

    // «За смаком» і продукти без калорій (сіль, вода) у покриття не входять:
    // їх неможливо зважити й вони нічого не додають до числа.
    const negligible = q?.unit === "taste" || (nut != null && nut.kcal === 0);
    if (!negligible) considered += 1;

    if (!nut || grams == null) {
      if (!negligible) skipped.push(item.label ?? def.label);
      continue;
    }

    const k = grams / 100;
    counted.kcal += nut.kcal * k;
    counted.protein += nut.protein * k;
    counted.fat += nut.fat * k;
    counted.carbs += nut.carbs * k;
    if (!negligible) usable += 1;
  }

  if (usable === 0) return null;

  const servings = Math.max(1, recipe.servings || 1);
  const total = round(counted);

  return {
    total,
    perServing: round({
      kcal: counted.kcal / servings,
      protein: counted.protein / servings,
      fat: counted.fat / servings,
      carbs: counted.carbs / servings,
    }),
    // Чисельник і знаменник рахуємо по одному й тому ж набору інгредієнтів.
    // Раніше в чисельник потрапляли ще й базові продукти, яких у знаменнику
    // не було, і покриття виходило 100% навіть тоді, коли пів рецепта
    // не порахувалось — а на цю цифру спирається довіра до всього числа.
    coverage: considered === 0 ? 1 : Math.min(1, usable / considered),
    skipped,
  };
}

function round(n: Nutrition): Nutrition {
  return {
    kcal: Math.round(n.kcal),
    protein: Math.round(n.protein * 10) / 10,
    fat: Math.round(n.fat * 10) / 10,
    carbs: Math.round(n.carbs * 10) / 10,
  };
}

/**
 * Калорійність порції: спершу з підрахунку по інгредієнтах, інакше — з поля
 * kcal, яке автор міг заповнити вручну.
 */
export function servingKcal(recipe: Recipe): number | null {
  const computed = recipeNutrition(recipe);
  if (computed && computed.coverage >= 0.5) return computed.perServing.kcal;
  return recipe.kcal ?? computed?.perServing.kcal ?? null;
}

/* ── Денний підсумок ──────────────────────────────────────────────────── */

export interface DayTotals extends Nutrition {
  /** Скільки страв зараховано. */
  meals: number;
  /** Скільки з них не мали даних для підрахунку. */
  unknown: number;
}

/**
 * Підсумок за день з історії готувань. Одне приготування = одна порція:
 * страву зазвичай готують на всіх, а зʼїдають свою частку.
 *
 * День рахуємо за місцевою датою, а не за UTC. Мітка готування — це момент
 * часу, і в Києві вечеря о першій ночі має мітку вчорашнього UTC-дня: за
 * UTC вона потрапляла у вчора, хоча людина вечеряла сьогодні. Решта
 * застосунку (план на тиждень) і так живе за місцевою датою.
 */
export function dayTotals(
  cooked: CookEvent[],
  recipeOf: (id: string) => Recipe | undefined,
  day: Date = new Date(),
): DayTotals {
  const key = dateKey(day);
  const totals: DayTotals = { ...ZERO, meals: 0, unknown: 0 };

  for (const event of cooked) {
    if (dateKey(new Date(event.at)) !== key) continue;
    totals.meals += 1;

    const recipe = recipeOf(event.recipeId);
    if (!recipe) {
      totals.unknown += 1;
      continue;
    }

    const n = recipeNutrition(recipe);
    if (n && n.coverage >= 0.5) {
      totals.kcal += n.perServing.kcal;
      totals.protein += n.perServing.protein;
      totals.fat += n.perServing.fat;
      totals.carbs += n.perServing.carbs;
    } else if (recipe.kcal) {
      totals.kcal += recipe.kcal;
      totals.unknown += 1;
    } else {
      totals.unknown += 1;
    }
  }

  const rounded = round(totals);
  return { ...rounded, meals: totals.meals, unknown: totals.unknown };
}

/** Частки БЖВ у калоріях — для смужки-розподілу. */
export function macroShares(n: Nutrition): { protein: number; fat: number; carbs: number } {
  const p = n.protein * 4;
  const f = n.fat * 9;
  const c = n.carbs * 4;
  const sum = p + f + c;
  if (sum <= 0) return { protein: 0, fat: 0, carbs: 0 };
  return { protein: p / sum, fat: f / sum, carbs: c / sum };
}
