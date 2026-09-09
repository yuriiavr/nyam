import { ing } from "@/data/ingredients";
import type { AppState } from "./store";
import { allRecipes, daysSinceCooked, effectiveStats } from "./store";
import type { MatchResult, MealType, Mood, Recipe } from "./types";
import { avgRating, currentMeal } from "./utils";

/* ── Фільтри ──────────────────────────────────────────────────────────── */

export type Pool = "all" | "mine" | "saved" | "following" | "wishlist" | "community";

export interface Filters {
  pool: Pool;
  meals: MealType[];
  moods: Mood[];
  maxTime: number | null;
  maxDifficulty: number | null;
  maxCost: number | null;
  cuisines: string[];
  query: string;
  /** виключити страви, приготовані за останні N днів */
  avoidRecentDays: number | null;
}

export const emptyFilters: Filters = {
  pool: "all",
  meals: [],
  moods: [],
  maxTime: null,
  maxDifficulty: null,
  maxCost: null,
  cuisines: [],
  query: "",
  avoidRecentDays: null,
};

export const POOL_LABEL: Record<Pool, string> = {
  all: "Усе",
  community: "Спільнота",
  mine: "Мої рецепти",
  saved: "Збережені",
  following: "Підписки",
  wishlist: "Хочу приготувати",
};

function inPool(state: AppState, r: Recipe, pool: Pool): boolean {
  switch (pool) {
    case "mine":
      return !!r.mine || r.authorId === state.profile.id;
    case "saved":
      return state.saved.includes(r.id) || !!r.mine;
    case "following":
      return state.following.includes(r.authorId);
    case "wishlist":
      return state.wishlist.includes(r.id);
    case "community":
      return r.authorId !== state.profile.id;
    default:
      return true;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[ʼ’`]/g, "'").trim();

export function applyFilters(state: AppState, f: Filters, source?: Recipe[]): Recipe[] {
  const base = source ?? allRecipes(state);
  const q = norm(f.query);
  return base.filter((r) => {
    if (!inPool(state, r, f.pool)) return false;
    if (f.meals.length && !f.meals.some((m) => r.mealTypes.includes(m))) return false;
    if (f.moods.length && !f.moods.some((m) => r.moods.includes(m))) return false;
    if (f.maxTime != null && r.timeMin > f.maxTime) return false;
    if (f.maxDifficulty != null && r.difficulty > f.maxDifficulty) return false;
    if (f.maxCost != null && r.costLevel > f.maxCost) return false;
    if (f.cuisines.length && !f.cuisines.includes(r.cuisine)) return false;
    if (f.avoidRecentDays != null && daysSinceCooked(state, r.id) < f.avoidRecentDays) return false;
    if (q) {
      const hay = [
        r.title,
        r.description,
        r.cuisine,
        ...r.tags,
        ...r.ingredients.map((i) => ing(i.key).label),
      ]
        .map(norm)
        .join(" ");
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.pool !== "all") n++;
  n += f.meals.length + f.moods.length + f.cuisines.length;
  if (f.maxTime != null) n++;
  if (f.maxDifficulty != null) n++;
  if (f.maxCost != null) n++;
  if (f.avoidRecentDays != null) n++;
  return n;
}

/* ── Підбір за холодильником ──────────────────────────────────────────── */

/**
 * Рахує, наскільки рецепт покривається наявними продуктами.
 * Базові продукти (сіль, олія, борошно) не штрафують — вважаємо, що вони є.
 */
export function matchRecipe(r: Recipe, have: Set<string>): MatchResult {
  const required = r.ingredients.filter((i) => !i.optional);
  const haveKeys: string[] = [];
  const missing: string[] = [];

  for (const item of required) {
    const def = ing(item.key);
    if (have.has(item.key)) haveKeys.push(item.key);
    else if (def.staple) haveKeys.push(item.key); // припускаємо, що є вдома
    else missing.push(item.key);
  }

  const total = haveKeys.length + missing.length;
  const pct = total === 0 ? 0 : Math.round((haveKeys.length / total) * 100);
  return { recipe: r, have: haveKeys, missing, pct };
}

export function fridgeMatches(
  recipes: Recipe[],
  pantry: string[],
  { minPct = 1 }: { minPct?: number } = {},
): MatchResult[] {
  const have = new Set(pantry);
  if (!have.size) return [];
  return recipes
    .map((r) => matchRecipe(r, have))
    .filter((m) => {
      // потрібне хоч одне реальне (не базове) співпадіння з коморою
      const realHit = m.recipe.ingredients.some((i) => have.has(i.key) && !ing(i.key).staple);
      return realHit && m.pct >= minPct;
    })
    .sort((a, b) => b.pct - a.pct || a.missing.length - b.missing.length);
}

/**
 * Що докупити, щоб розблокувати найбільше рецептів.
 * Повертає ключі продуктів, відсортовані за кількістю рецептів, які вони відкривають.
 */
export function shoppingSuggestions(
  recipes: Recipe[],
  pantry: string[],
  limit = 8,
): Array<{ key: string; unlocks: number }> {
  const have = new Set(pantry);
  const counter = new Map<string, number>();
  for (const r of recipes) {
    const m = matchRecipe(r, have);
    if (m.missing.length === 0 || m.missing.length > 2) continue; // майже готові
    for (const key of m.missing) counter.set(key, (counter.get(key) ?? 0) + 1);
  }
  return [...counter.entries()]
    .map(([key, unlocks]) => ({ key, unlocks }))
    .sort((a, b) => b.unlocks - a.unlocks)
    .slice(0, limit);
}

/* ── Популярність і тренди ────────────────────────────────────────────── */

export function popularityScore(state: AppState, r: Recipe): number {
  const s = effectiveStats(state, r);
  const rating = avgRating({ ...r, stats: s });
  return s.likes * 1 + s.saves * 1.6 + s.cooks * 2.2 + rating * 120;
}

/** Популярність із затуханням за віком публікації — «зараз у тренді». */
export function trendingScore(state: AppState, r: Recipe): number {
  const ageDays = Math.max(0.5, (Date.now() - new Date(r.createdAt).getTime()) / 86_400_000);
  return popularityScore(state, r) / Math.pow(ageDays + 2, 0.62);
}

export function topBy(
  state: AppState,
  recipes: Recipe[],
  mode: "trending" | "popular" | "new" | "rating",
): Recipe[] {
  const list = [...recipes];
  switch (mode) {
    case "trending":
      return list.sort((a, b) => trendingScore(state, b) - trendingScore(state, a));
    case "popular":
      return list.sort((a, b) => popularityScore(state, b) - popularityScore(state, a));
    case "new":
      return list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    case "rating":
      return list.sort(
        (a, b) =>
          avgRating({ ...b, stats: effectiveStats(state, b) }) -
          avgRating({ ...a, stats: effectiveStats(state, a) }),
      );
  }
}

/* ── Персональні рекомендації ─────────────────────────────────────────── */

interface Taste {
  cuisines: Map<string, number>;
  tags: Map<string, number>;
  moods: Map<string, number>;
  ingredients: Map<string, number>;
  avgTime: number | null;
}

/** Будує профіль смаку з лайків, збережень, оцінок і історії готування. */
export function buildTaste(state: AppState): Taste {
  const cuisines = new Map<string, number>();
  const tags = new Map<string, number>();
  const moods = new Map<string, number>();
  const ingredients = new Map<string, number>();
  const times: number[] = [];

  const bump = (m: Map<string, number>, k: string, w: number) =>
    m.set(k, (m.get(k) ?? 0) + w);

  const signals: Array<[string, number]> = [
    ...state.likes.map((id) => [id, 1] as [string, number]),
    ...state.saved.map((id) => [id, 1.5] as [string, number]),
    ...state.wishlist.map((id) => [id, 1.2] as [string, number]),
    ...state.cooked.map((c) => [c.recipeId, 2] as [string, number]),
    ...Object.entries(state.ratings).map(([id, s]) => [id, (s - 3) * 1.2] as [string, number]),
  ];

  const byId = new Map(allRecipes(state).map((r) => [r.id, r]));
  for (const [id, w] of signals) {
    const r = byId.get(id);
    if (!r || w === 0) continue;
    bump(cuisines, r.cuisine, w);
    r.tags.forEach((t) => bump(tags, t, w));
    r.moods.forEach((m) => bump(moods, m, w));
    r.ingredients.forEach((i) => bump(ingredients, i.key, w * 0.4));
    if (w > 0) times.push(r.timeMin);
  }

  return {
    cuisines,
    tags,
    moods,
    ingredients,
    avgTime: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
  };
}

export interface Recommendation {
  recipe: Recipe;
  score: number;
  reasons: string[];
}

/**
 * Персональна добірка: смак + вміст холодильника + час доби
 * + штраф за нещодавно приготоване.
 */
export function recommend(
  state: AppState,
  opts: { limit?: number; pool?: Recipe[]; respectPantry?: boolean } = {},
): Recommendation[] {
  const { limit = 20, respectPantry = true } = opts;
  const taste = buildTaste(state);
  const have = new Set(state.pantry.map((p) => p.key));
  const meal = currentMeal();
  const seen = new Set([...state.dismissed]);

  const pool = (opts.pool ?? allRecipes(state)).filter((r) => !seen.has(r.id));

  const scored = pool.map((r) => {
    const reasons: string[] = [];
    let score = 0;

    // Базова якість
    const stats = effectiveStats(state, r);
    const rating = avgRating({ ...r, stats });
    score += rating * 8;
    score += Math.log10(1 + stats.cooks) * 6;

    // Смаковий профіль
    const cuisineW = taste.cuisines.get(r.cuisine) ?? 0;
    if (cuisineW > 0.8) {
      score += Math.min(18, cuisineW * 4);
      reasons.push(`ти любиш ${r.cuisine.toLowerCase()} кухню`);
    }
    const tagHit = r.tags.find((t) => (taste.tags.get(t) ?? 0) > 1);
    if (tagHit) {
      score += 8;
      reasons.push(`часто обираєш «${tagHit}»`);
    }
    const moodHit = r.moods.find((m) => (taste.moods.get(m) ?? 0) > 1.5);
    if (moodHit) score += 6;

    // Час доби
    if (r.mealTypes.includes(meal as MealType)) {
      score += 12;
      reasons.push("пасує до цього часу доби");
    }

    // Холодильник
    if (respectPantry && have.size) {
      const m = matchRecipe(r, have);
      score += (m.pct / 100) * 26;
      if (m.missing.length === 0) reasons.push("усе є в коморі");
      else if (m.missing.length === 1) reasons.push(`бракує лише: ${ing(m.missing[0]).label.toLowerCase()}`);
    }

    // Типовий час готування користувача
    if (taste.avgTime != null && Math.abs(r.timeMin - taste.avgTime) < 15) score += 5;

    // Не повторюйся
    const since = daysSinceCooked(state, r.id);
    if (since < 3) score -= 40;
    else if (since < 10) score -= 14;
    else if (since === Infinity) {
      score += 6;
      reasons.push("ще не готував");
    }

    // Легкий шум, щоб добірка не була однаковою щоразу
    score += Math.random() * 4;

    return { recipe: r, score, reasons: reasons.slice(0, 2) };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ── Погода → що їсти ─────────────────────────────────────────────────── */

export interface WeatherHint {
  moods: Mood[];
  title: string;
  note: string;
  emoji: string;
}

export function weatherHint(tempC: number, code: number): WeatherHint {
  const rainy = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code);
  const snowy = [71, 73, 75, 77, 85, 86].includes(code);

  if (snowy || tempC <= 2) {
    return {
      moods: ["cozy", "comfort", "hearty"],
      title: "Надворі мороз",
      note: "Саме час для гарячого супу і чогось ситного.",
      emoji: "❄️",
    };
  }
  if (rainy) {
    return {
      moods: ["comfort", "cozy"],
      title: "Дощить",
      note: "Комфорт-фуд і щось тепле — найкращий план.",
      emoji: "🌧️",
    };
  }
  if (tempC >= 26) {
    return {
      moods: ["fresh", "healthy", "fast"],
      title: "Спека",
      note: "Плиту краще не вмикати. Свіже і холодне.",
      emoji: "🥵",
    };
  }
  if (tempC >= 16) {
    return {
      moods: ["fresh", "healthy"],
      title: "Гарна погода",
      note: "Легке та швидке зайде найкраще.",
      emoji: "☀️",
    };
  }
  return {
    moods: ["cozy", "comfort"],
    title: "Прохолодно",
    note: "Щось тепле й затишне.",
    emoji: "🌤️",
  };
}

/* ── Генератор плану на тиждень ───────────────────────────────────────── */

export function generateWeekPlan(
  state: AppState,
  days: string[],
  slots: Array<"breakfast" | "lunch" | "dinner">,
): Record<string, Partial<Record<"breakfast" | "lunch" | "dinner", string>>> {
  const used = new Set<string>();
  const plan: Record<string, Partial<Record<"breakfast" | "lunch" | "dinner", string>>> = {};

  for (const day of days) {
    plan[day] = {};
    for (const slot of slots) {
      const candidates = recommend(state, {
        limit: 40,
        respectPantry: false,
      }).filter(
        (rec) => rec.recipe.mealTypes.includes(slot as MealType) && !used.has(rec.recipe.id),
      );
      const chosen = candidates[Math.floor(Math.random() * Math.min(6, candidates.length))];
      if (chosen) {
        plan[day][slot] = chosen.recipe.id;
        used.add(chosen.recipe.id);
      }
    }
  }
  return plan;
}

/** Об'єднаний список покупок для набору рецептів з урахуванням комори. */
export function shoppingListFor(
  recipes: Recipe[],
  pantry: string[],
): Array<{ key: string; qtys: string[]; count: number }> {
  const have = new Set(pantry);
  const map = new Map<string, { qtys: string[]; count: number }>();
  for (const r of recipes) {
    for (const item of r.ingredients) {
      if (item.optional) continue;
      if (have.has(item.key) || ing(item.key).staple) continue;
      const entry = map.get(item.key) ?? { qtys: [], count: 0 };
      if (item.qty) entry.qtys.push(item.qty);
      entry.count += 1;
      map.set(item.key, entry);
    }
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.count - a.count);
}
