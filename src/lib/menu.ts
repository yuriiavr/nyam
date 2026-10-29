import { courseOf } from "./course";
import { addNutrition, roundNutrition, scaleNutrition, ZERO } from "./diary";
import { recipeNutrition } from "./nutrition";
import type { Course, Nutrition, PlanSlot, Recipe } from "./types";

/**
 * Меню з рецептів під денну ціль калорій і БЖВ.
 *
 * На кожен день перебираємо сніданок × обід × вечерю разом із порціями й
 * беремо набір, чиї калорії й БЖВ найближчі до цілі. Порції — головний важіль:
 * рецептів у сімʼї десятки, а не тисячі, і карбонару на 1270 ккал за порцію
 * під ціль 2000 вміщає лише пів порції. Тому порцію рахуємо від апетиту
 * людини й штрафуємо, що далі вона від звичної.
 *
 * Дні йдуть по черзі: страва, що вже була цього тижня, а надто вчора,
 * трохи дорожча, тож меню не повторюється без потреби. Невеликий шум від
 * номера варіанта розводить майже рівні набори — «інший варіант» дає інше
 * меню, а той самий номер завжди те саме (його й зберігаємо після згоди).
 */

export const MENU_SLOTS: PlanSlot[] = ["breakfast", "lunch", "dinner"];

/**
 * Скільки денної цілі зазвичай припадає на прийом. Не знайшлось рецепта на
 * сніданок — ціль дня меншає на його частку, а не перепадає обіду.
 */
export const SLOT_SHARE: Record<PlanSlot, number> = { breakfast: 0.25, lunch: 0.4, dinner: 0.35 };

/** Гарнір, соус чи напій сам по собі — не прийом їжі. */
const NOT_A_MEAL = new Set<Course>(["side", "sauce", "drink"]);

/** Порції як частки звичної (апетиту). */
const PORTION_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5];

const KEYS = ["kcal", "protein", "fat", "carbs"] as const;
/** Калорії й білок важать більше: жири й вуглеводи легше добрати перекусом. */
const WEIGHT: Record<(typeof KEYS)[number], number> = { kcal: 1, protein: 1, fat: 0.7, carbs: 0.7 };

const PORTION_COST = 0.03;
const REPEAT_COST = 0.06;
const YESTERDAY_COST = 0.06;
const SAME_DAY_COST = 0.25;
const NOISE = 0.03;
/** Скільки найкращих «страва × порція» на прийом іде в перебір. */
const OPTIONS_PER_SLOT = 48;

/** Ціль: задані показники; незадані на добір не впливають. */
export type MenuTargets = Partial<Nutrition>;

export interface MenuDish {
  id: string;
  title: string;
  emoji: string;
  /** Прийоми, на які рецепт годиться. */
  slots: PlanSlot[];
  /** КБЖВ однієї порції рецепта; немає — у добір не йде. */
  perServing?: Nutrition;
}

export interface MenuPick {
  slot: PlanSlot;
  dish: MenuDish;
  /** Скільки порцій рецепта зʼїсти. */
  portions: number;
  /** Немає — у рецепта невідомі КБЖВ (лише серед того, що вже стояло в плані). */
  nutrition?: Nutrition;
  /** Уже стояло в плані — лишили й зарахували в ціль. */
  kept: boolean;
}

export interface MenuDay {
  day: string;
  picks: MenuPick[];
  /** Прийоми, під які не знайшлось жодного рецепта з КБЖВ. */
  empty: PlanSlot[];
  total: Nutrition;
  /** Ціль дня без частки порожніх прийомів. */
  target: MenuTargets;
}

export function menuDish(recipe: Recipe): MenuDish {
  const n = recipeNutrition(recipe);
  const known = n && (n.source === "ai" || n.coverage >= 0.5);
  return {
    id: recipe.id,
    title: recipe.title,
    emoji: recipe.emoji,
    slots: NOT_A_MEAL.has(courseOf(recipe)) ? [] : MENU_SLOTS.filter((s) => recipe.mealTypes.includes(s)),
    ...(known ? { perServing: n.perServing } : {}),
  };
}

/** Частка дня, яку покривають ці прийоми: ціль на обід — 0,4 денної. */
export function slotShare(slots: readonly PlanSlot[]): number {
  return [...new Set(slots)].reduce((sum, s) => sum + SLOT_SHARE[s], 0);
}

export function scaleTargets(target: MenuTargets, factor: number): MenuTargets {
  const out: MenuTargets = {};
  for (const k of KEYS) if (target[k] != null) out[k] = Math.round((target[k] as number) * factor);
  return out;
}

/** Наскільки набір далекий від цілі: сума квадратів відносних промахів. */
export function menuMiss(total: Nutrition, target: MenuTargets): number {
  let sum = 0;
  for (const k of KEYS) {
    const t = target[k];
    if (!t || t <= 0) continue;
    const d = (total[k] - t) / t;
    sum += WEIGHT[k] * d * d;
  }
  return sum;
}

/** Порції, які пропонуємо: від апетиту, з кроком у чверть. */
export function portionOptions(appetite: number): number[] {
  const base = appetite > 0 ? appetite : 1;
  return [...new Set(PORTION_STEPS.map((m) => Math.max(0.25, Math.round(base * m * 4) / 4)))];
}

/** Детермінований шум 0..1: той самий варіант — те саме меню. */
function noise(...parts: Array<string | number>): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

interface Option {
  dish: MenuDish;
  portions: number;
  nutrition: Nutrition;
  /** Штраф поза ціллю: порція, повтори, шум. */
  cost: number;
}

export function planMenu(input: {
  dishes: readonly MenuDish[];
  days: readonly string[];
  slots: readonly PlanSlot[];
  /** Ціль на обрані прийоми за день. */
  target: MenuTargets;
  /** Звична порція людини (апетит із налаштувань щоденника). */
  appetite?: number;
  /** Що вже стоїть у плані: лишається й зараховується в ціль. */
  kept?: Record<string, Partial<Record<PlanSlot, MenuDish>>>;
  /** Номер варіанта: інше число — інший, теж близький до цілі набір. */
  variant?: number;
}): MenuDay[] {
  const appetite = input.appetite && input.appetite > 0 ? input.appetite : 1;
  const usual = Math.max(0.25, Math.round(appetite * 4) / 4);
  const portions = portionOptions(appetite);
  const slots = MENU_SLOTS.filter((s) => input.slots.includes(s));
  const share = slotShare(slots) || 1;
  const usedCount = new Map<string, number>();
  let yesterday = new Set<string>();
  const days: MenuDay[] = [];

  for (const day of input.days) {
    const kept = input.kept?.[day] ?? {};
    const keptPicks: MenuPick[] = slots.flatMap((slot) => {
      const dish = kept[slot];
      if (!dish) return [];
      const nutrition = dish.perServing ? roundNutrition(scaleNutrition(dish.perServing, usual)) : undefined;
      return [{ slot, dish, portions: usual, ...(nutrition ? { nutrition } : {}), kept: true }];
    });
    const open = slots.filter((s) => !kept[s]);
    const pool = new Map(open.map((slot) => [slot, input.dishes.filter((d) => d.perServing && d.slots.includes(slot))]));
    const empty = open.filter((s) => !pool.get(s)?.length);
    const filled = open.filter((s) => pool.get(s)?.length);
    const target = scaleTargets(input.target, 1 - slotShare(empty) / share);
    const base = keptPicks.reduce((sum, p) => (p.nutrition ? addNutrition(sum, p.nutrition) : sum), ZERO);

    const optionCost = (dish: MenuDish, p: number) =>
      PORTION_COST * ((p - appetite) / appetite) ** 2 +
      REPEAT_COST * (usedCount.get(dish.id) ?? 0) +
      (yesterday.has(dish.id) ? YESTERDAY_COST : 0) +
      NOISE * noise(input.variant ?? 0, day, dish.id);

    // Кожен прийом окремо — щоб відсіяти явно зайве до спільного перебору.
    const options = filled.map((slot) => {
      const slotTarget = scaleTargets(input.target, SLOT_SHARE[slot] / share);
      const list: Array<Option & { alone: number }> = [];
      for (const dish of pool.get(slot) ?? []) {
        for (const p of portions) {
          const nutrition = scaleNutrition(dish.perServing as Nutrition, p);
          const cost = optionCost(dish, p);
          list.push({ dish, portions: p, nutrition, cost, alone: menuMiss(nutrition, slotTarget) + cost });
        }
      }
      return list.sort((a, b) => a.alone - b.alone).slice(0, OPTIONS_PER_SLOT);
    });

    const best = { score: Infinity, chosen: [] as Option[] };
    const chosen: Option[] = [];
    const walk = (i: number, sum: Nutrition, cost: number) => {
      if (i === options.length) {
        const score = menuMiss(sum, target) + cost;
        if (score < best.score) {
          best.score = score;
          best.chosen = [...chosen];
        }
        return;
      }
      for (const o of options[i]) {
        const twice = chosen.some((c) => c.dish.id === o.dish.id) || keptPicks.some((k) => k.dish.id === o.dish.id);
        chosen.push(o);
        walk(i + 1, addNutrition(sum, o.nutrition), cost + o.cost + (twice ? SAME_DAY_COST : 0));
        chosen.pop();
      }
    };
    walk(0, base, 0);

    const newPicks: MenuPick[] = best.chosen.map((o, i) => ({
      slot: filled[i],
      dish: o.dish,
      portions: o.portions,
      nutrition: roundNutrition(o.nutrition),
      kept: false,
    }));
    const picks = [...keptPicks, ...newPicks].sort((a, b) => MENU_SLOTS.indexOf(a.slot) - MENU_SLOTS.indexOf(b.slot));
    const total = roundNutrition(picks.reduce((sum, p) => (p.nutrition ? addNutrition(sum, p.nutrition) : sum), ZERO));
    days.push({ day, picks, empty, total, target });

    yesterday = new Set(picks.map((p) => p.dish.id));
    for (const p of picks) usedCount.set(p.dish.id, (usedCount.get(p.dish.id) ?? 0) + 1);
  }
  return days;
}
