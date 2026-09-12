import { DRINKS, type DrinkDef, type DrinkKind } from "@/data/drinks";
import { ing } from "@/data/ingredients";
import { servingKcal } from "./nutrition";
import type { AppState } from "./store";
import type { Course, Recipe } from "./types";
import { dateKey } from "./utils";

/**
 * Що до чого подавати.
 *
 * Головне рішення тут — не заводити ручні пари. Двадцять три рецепти дають
 * пʼятсот можливих сполучень, сотня — десять тисяч; заповнювати це нікому, а
 * напівзаповнений список гірший за відсутній, бо мовчить саме там, де його
 * питають. Тому пари виводяться з даних, які застосунок і так має: частина
 * прийому їжі, кухня, склад, час, калорійність, вміст комори.
 *
 * І одне джерело, якого немає більше ні в кого: власна історія готувань.
 * Якщо ви двічі їли гречку з тією самою куркою, застосунок це бачить і надалі
 * ставить її першою. Тобто підказки стають кращими від користування, а не від
 * того, що хтось сів і заповнив таблицю.
 */

export const COURSE_LABEL: Record<Course, string> = {
  whole: "Самодостатня страва",
  main: "Основна страва",
  side: "Гарнір",
  soup: "Суп",
  salad: "Салат",
  snack: "Закуска",
  sauce: "Соус",
  dessert: "Десерт",
  drink: "Напій",
};

/**
 * Що має сенс крутити в рулетці.
 *
 * Колесо відповідає на питання «що готувати», тож туди йдуть і самодостатні
 * страви, і основні, і гарніри: гарнір, що випав сам, — це не помилка, до
 * нього просто підкажемо пару. А соус і напій стравою не є: випав соус —
 * і вечері в тебе немає.
 *
 * Правило діє, лише поки ти сам не обрав частину страви у фільтрах. Обрав
 * «десерт» — крутиться десерт: явне прохання сильніше за замовчування.
 */
export const WHEEL_COURSES: Course[] = [
  "whole",
  "main",
  "side",
  "soup",
  "salad",
];

/** Порядок для фільтрів і форми — від найчастішого до рідкісного. */
export const COURSE_ORDER: Course[] = [
  "whole",
  "main",
  "side",
  "soup",
  "salad",
  "snack",
  "dessert",
  "drink",
  "sauce",
];

/**
 * Що з чим подають. Самодостатньої страви тут немає навмисно: пропонувати
 * гарнір до піци — це не порада, а шум.
 */
const GOES_WITH: Partial<Record<Course, Course[]>> = {
  main: ["side", "salad", "sauce"],
  side: ["main", "soup"],
  soup: ["salad", "snack"],
  salad: ["main", "soup"],
  snack: ["soup", "drink"],
  sauce: ["main", "side"],
  dessert: ["drink"],
};

/** Заголовок підказки залежить від того, чим є сама страва. */
export const PAIR_HEADING: Partial<Record<Course, string>> = {
  main: "В якості гарніру можна взяти",
  side: "До цього гарніру добре підійде",
  soup: "До супу добре йде",
  salad: "З цим салатом добре поєднується",
  snack: "До цієї закуски",
  sauce: "Цей соус добре йде до",
  dessert: "До десерту",
};

/**
 * Чим страва є на столі.
 *
 * Поле необовʼязкове, і для рецептів, створених до його появи, частину
 * виводимо з того, що вже відомо. Здогадка свідомо обережна: коли ознак
 * немає, страва вважається самодостатньою й у підказки не лізе.
 */
export function courseOf(recipe: Recipe): Course {
  if (recipe.course) return recipe.course;

  const text = `${recipe.title} ${recipe.tags.join(" ")}`.toLowerCase();
  if (recipe.mealTypes.includes("drink")) return "drink";
  if (recipe.mealTypes.includes("dessert")) return "dessert";
  if (/суп|борщ|бульйон|юшка/.test(text)) return "soup";
  if (/салат/.test(text)) return "salad";
  if (/гарнір/.test(text)) return "side";
  if (/соус|заправ/.test(text)) return "sauce";
  if (recipe.mealTypes.includes("snack")) return "snack";
  return "whole";
}

export interface Pairing {
  recipe: Recipe;
  /** Чому саме ця страва — рядок під назвою в картці. */
  reason: string;
  score: number;
}

/** Непусті, небазові інгредієнти: саме за ними видно повтор у парі. */
function coreKeys(recipe: Recipe): Set<string> {
  return new Set(
    recipe.ingredients
      .filter((i) => !i.optional && !ing(i.key).staple)
      .map((i) => i.key),
  );
}

/**
 * Скільки разів ці дві страви готували одного дня.
 *
 * Це найсильніший сигнал з усіх: він не здогадка, а те, що в цьому домі
 * справді їли разом.
 */
function cookedTogether(
  cooked: AppState["cooked"],
  a: string,
  b: string,
): number {
  const byDay = new Map<string, Set<string>>();
  for (const event of cooked) {
    const day = dateKey(new Date(event.at));
    const set = byDay.get(day) ?? new Set<string>();
    set.add(event.recipeId);
    byDay.set(day, set);
  }

  let times = 0;
  for (const set of byDay.values()) if (set.has(a) && set.has(b)) times += 1;
  return times;
}

/**
 * Підбирає, що подати разом із цією стравою.
 *
 * Порядок сигналів свідомий: спершу те, що вже перевірено власною кухнею,
 * далі те, що просто пасує, і аж потім те, що популярне. Популярність тут
 * остання навмисно — інакше до всього радили б борщ.
 */
export function suggestPairs(
  state: AppState,
  recipe: Recipe,
  pool: Recipe[],
  limit = 3,
): Pairing[] {
  const wanted = GOES_WITH[courseOf(recipe)];
  if (!wanted) return [];

  const mine = coreKeys(recipe);
  const kcal = servingKcal(recipe);
  const heavy = kcal != null && kcal > 500;
  const pantry = new Set(state.pantry.map((p) => p.key));

  const scored: Pairing[] = [];

  for (const candidate of pool) {
    if (candidate.id === recipe.id) continue;
    if (!wanted.includes(courseOf(candidate))) continue;

    let score = 0;
    /*
     * Причини збираємо всі, а показуємо одну — найвагомішу. Раніше тут
     * бралася перша за порядком у коді, і нею майже завжди виявлявся час
     * приготування: підказки виглядали однаково й не пояснювали нічого.
     */
    const reasons: Array<{ weight: number; text: string }> = [];

    // 1. Уже їли разом — найсильніше, бо це не здогадка.
    const together = cookedTogether(state.cooked, recipe.id, candidate.id);
    if (together > 0) {
      score += 60 * Math.min(together, 3);
      reasons.push({
        weight: 100,
        text: together === 1 ? "ви вже так їли" : `ви так їли ${together} рази`,
      });
    }

    // 2. Повтор інгредієнтів — найгірше, що може бути в парі: картопля
    //    до картопляного пюре виглядає як помилка, і це вона і є.
    const theirs = coreKeys(candidate);
    let repeats = 0;
    for (const key of theirs) if (mine.has(key)) repeats += 1;
    score -= repeats * 25;

    // 3. Та сама кухня.
    if (candidate.cuisine === recipe.cuisine) {
      score += 20;
      reasons.push({
        weight: 60,
        text: `та сама кухня — ${candidate.cuisine.toLowerCase()}`,
      });
    }

    // 4. Пара не має готуватись довше за головну страву.
    if (candidate.timeMin <= recipe.timeMin) {
      score += 15;
      reasons.push({
        weight: 20,
        text: `готується за ${candidate.timeMin} хв`,
      });
    } else {
      score -= Math.min(20, candidate.timeMin - recipe.timeMin);
    }

    // 5. До ситного — легше, до легкого — ситніше.
    const theirKcal = servingKcal(candidate);
    if (theirKcal != null) {
      const light = theirKcal < 300;
      if (heavy === light) {
        score += 12;
        reasons.push({
          weight: 40,
          text: heavy ? "легше до ситного" : "додає ситності",
        });
      }
    }

    // 6. Те, що вже є вдома, краще за те, по що треба йти.
    const missing = [...theirs].filter((key) => !pantry.has(key)).length;
    score += Math.max(0, 12 - missing * 4);
    if (missing === 0 && pantry.size > 0) {
      reasons.push({ weight: 80, text: "усе вже є в коморі" });
    }

    // 7. Популярність — лише щоб розвести однакові.
    score += Math.min(8, candidate.stats.cooks / 25);

    const reason =
      reasons.sort((a, b) => b.weight - a.weight)[0]?.text ??
      "пасує за складом";

    scored.push({
      recipe: candidate,
      reason: reason || "пасує за складом",
      score,
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ── Напої ────────────────────────────────────────────────────────────── */

export interface DrinkPick {
  drink: DrinkDef;
  /** Чому саме цей напій — рядок під назвою. */
  reason: string;
  /** Чи стоїть він уже в коморі. */
  home: boolean;
  score: number;
}

/**
 * Що до цієї страви випити.
 *
 * Працює за тими самими правилами, що й пари страв, з однією поправкою на
 * природу напою: він залежить від години. Кава о десятій вечора й вино о
 * дев'ятій ранку — це не поради, а знущання, тож час доби тут такий самий
 * сигнал, як кухня чи склад.
 *
 * З кожного роду беремо щонайбільше один: три чаї підряд — це не вибір.
 */
export function suggestDrinks(
  state: AppState,
  recipe: Recipe,
  limit = 3,
  now: Date = new Date(),
): DrinkPick[] {
  const course = courseOf(recipe);
  const hour = now.getHours();
  const pantry = new Set(state.pantry.map((p) => p.key));
  const kcal = servingKcal(recipe);
  const heavy = (kcal != null && kcal > 500) || recipe.moods.includes("hearty");
  const cuisine = recipe.cuisine.toLowerCase();

  const picks: Array<DrinkPick & { order: number }> = [];

  for (const [order, drink] of DRINKS.entries()) {
    if (!drink.courses.includes(course)) continue;

    let score = 20;
    const reasons: Array<{ weight: number; text: string }> = [];

    // Те, що вже стоїть у холодильнику, краще за те, по що треба йти.
    const home = drink.ingredient ? pantry.has(drink.ingredient) : false;
    if (home) {
      score += 30;
      reasons.push({ weight: 90, text: "вже є в коморі" });
    }

    // Гостре з кефіром пече менше — це не про смак, а про те, як воно їсться.
    const tamed = drink.tames?.find((m) => recipe.moods.includes(m));
    if (tamed === "spicy") {
      score += 35;
      reasons.push({ weight: 80, text: "гостре стане мʼякшим" });
    }

    if (drink.cuisines?.some((c) => cuisine.includes(c))) {
      score += 30;
      // Називний відмінок навмисно: кухні в рецептах — вільний текст, і
      // «до італійської» з «до здорове» одним правилом не зробиш.
      reasons.push({ weight: 70, text: `${cuisine} кухня` });
    }

    if (heavy && drink.light) {
      score += 22;
      reasons.push({ weight: 60, text: "не обтяжує після ситного" });
    }

    // Година. Кофеїн увечері й алкоголь до вечері вимикаємо повністю:
    // від'ємний рахунок не показуємо взагалі.
    if (drink.caffeine) {
      if (hour >= 17) score -= 60;
      else if (hour < 11) {
        score += 22;
        reasons.push({ weight: 50, text: "саме на ранок" });
      }
    }
    if (drink.alcohol) {
      if (hour < 16) score -= 90;
      else {
        score += 14;
        reasons.push({ weight: 45, text: "під вечерю" });
      }
    }

    if (score <= 0) continue;

    picks.push({
      drink,
      order,
      home,
      reason:
        reasons.sort((a, b) => b.weight - a.weight)[0]?.text ?? "просто пасує",
      score,
    });
  }

  // За рівного рахунку виграє той, хто в списку вище: він там не випадково.
  picks.sort((a, b) => b.score - a.score || a.order - b.order);

  const out: DrinkPick[] = [];
  const kinds = new Set<DrinkKind>();
  for (const pick of picks) {
    if (kinds.has(pick.drink.kind)) continue;
    kinds.add(pick.drink.kind);
    out.push(pick);
    if (out.length >= limit) break;
  }
  return out;
}
