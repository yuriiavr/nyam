"use client";

import { getSupabase } from "./client";
import { isUuid } from "./api";
import type {
  DiarySettings,
  FoodEntry,
  FoodSource,
  Meal,
  MealItem,
  MealSlot,
  Nutrition,
  PantryTaken,
} from "@/lib/types";
import { parsePantryTaken } from "@/lib/pantry";

/**
 * Щоденник у базі (supabase/food-diary.sql): записи, страви, налаштування й
 * ключі голосового помічника. Рядки бази й назви колонок живуть тут і далі
 * не виходять — решта застосунку бачить лише типи з types.ts.
 */

/** Скільки днів історії тягнемо: два тижні графіка й запас на «тиждень тому». */
export const DIARY_DAYS = 45;

const n = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};

function nutritionOf(row: { kcal?: unknown; protein?: unknown; fat?: unknown; carbs?: unknown }): Nutrition | undefined {
  const kcal = n(row.kcal);
  if (kcal == null) return undefined;
  return { kcal, protein: n(row.protein) ?? 0, fat: n(row.fat) ?? 0, carbs: n(row.carbs) ?? 0 };
}

const nutritionColumns = (x?: Nutrition) => ({
  kcal: x ? Math.round(x.kcal * 10) / 10 : null,
  protein: x ? Math.round(x.protein * 10) / 10 : null,
  fat: x ? Math.round(x.fat * 10) / 10 : null,
  carbs: x ? Math.round(x.carbs * 10) / 10 : null,
});

/* ── Рядки ────────────────────────────────────────────────────────────── */

interface MealRow {
  id: string;
  user_id: string;
  recipe_id: string | null;
  title: string;
  emoji: string | null;
  servings: number | string;
  kcal: number | string | null;
  protein: number | string | null;
  fat: number | string | null;
  carbs: number | string | null;
  items: unknown;
  note: string | null;
  cooked_at: string;
  eaten: number | string;
  finished: boolean;
  pantry_taken: unknown;
}

interface FoodRow {
  id: string;
  user_id: string;
  logged_by: string | null;
  eaten_at: string;
  slot: string;
  title: string;
  emoji: string | null;
  product_id: string | null;
  meal_id: string | null;
  share: number | string | null;
  grams: number | string | null;
  kcal: number | string | null;
  protein: number | string | null;
  fat: number | string | null;
  carbs: number | string | null;
  source: string;
  pantry_taken: unknown;
}

interface SettingsRow {
  user_id: string;
  kcal_goal: number | null;
  protein_goal: number | null;
  fat_goal: number | null;
  carbs_goal: number | null;
  appetite: number | string;
  share_diary: boolean;
}

const MEAL_SELECT =
  "id,user_id,recipe_id,title,emoji,servings,kcal,protein,fat,carbs,items,note,cooked_at,eaten,finished,pantry_taken";
const FOOD_SELECT =
  "id,user_id,logged_by,eaten_at,slot,title,emoji,product_id,meal_id,share,grams,kcal,protein,fat,carbs,source,pantry_taken";

const SLOTS = new Set<MealSlot>(["breakfast", "lunch", "dinner", "snack"]);
const SOURCES = new Set<FoodSource>(["scan", "search", "dish", "cook", "leftover", "voice", "manual"]);

function itemsOf(raw: unknown): MealItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .filter((x) => typeof x.name === "string" && n(x.grams) != null)
    .map((x) => ({
      name: String(x.name),
      grams: n(x.grams) ?? 0,
      ...(typeof x.productId === "string" ? { productId: x.productId } : {}),
      ...(typeof x.typeKey === "string" ? { typeKey: x.typeKey } : {}),
      ...(typeof x.pantryId === "string" ? { pantryId: x.pantryId } : {}),
      kcal: n(x.kcal) ?? 0,
      protein: n(x.protein) ?? 0,
      fat: n(x.fat) ?? 0,
      carbs: n(x.carbs) ?? 0,
      from: x.from === "label" || x.from === "catalog" ? x.from : "ai",
    }));
}

/**
 * Колонку шлемо, лише коли знаємо, що в ній: невідоме (записав сервер, а до
 * нас ще не дійшло) не можна затерти порожнім.
 */
const takenColumn = (taken?: PantryTaken[]) => (taken ? { pantry_taken: taken } : {});

export function rowToMeal(row: MealRow): Meal {
  return {
    id: row.id,
    ownerId: row.user_id,
    ...(row.recipe_id ? { recipeId: row.recipe_id } : {}),
    title: row.title,
    emoji: row.emoji ?? "🍽️",
    servings: n(row.servings) ?? 1,
    nutrition: nutritionOf(row),
    items: itemsOf(row.items),
    ...(row.note ? { note: row.note } : {}),
    cookedAt: row.cooked_at,
    eaten: n(row.eaten) ?? 0,
    finished: Boolean(row.finished),
    ...(parsePantryTaken(row.pantry_taken) ? { pantryTaken: parsePantryTaken(row.pantry_taken) } : {}),
  };
}

export function rowToEntry(row: FoodRow): FoodEntry {
  return {
    id: row.id,
    userId: row.user_id,
    ...(row.logged_by ? { loggedBy: row.logged_by } : {}),
    eatenAt: row.eaten_at,
    slot: SLOTS.has(row.slot as MealSlot) ? (row.slot as MealSlot) : "snack",
    title: row.title,
    emoji: row.emoji ?? "🍽️",
    ...(row.product_id ? { productId: row.product_id } : {}),
    ...(row.meal_id ? { mealId: row.meal_id } : {}),
    ...(n(row.share) != null ? { share: n(row.share) } : {}),
    ...(n(row.grams) != null ? { grams: n(row.grams) } : {}),
    nutrition: nutritionOf(row),
    source: SOURCES.has(row.source as FoodSource) ? (row.source as FoodSource) : "manual",
    ...(parsePantryTaken(row.pantry_taken) ? { pantryTaken: parsePantryTaken(row.pantry_taken) } : {}),
  };
}

function rowToSettings(row: SettingsRow): DiarySettings {
  return {
    userId: row.user_id,
    ...(row.kcal_goal != null ? { kcalGoal: row.kcal_goal } : {}),
    ...(row.protein_goal != null ? { proteinGoal: row.protein_goal } : {}),
    ...(row.fat_goal != null ? { fatGoal: row.fat_goal } : {}),
    ...(row.carbs_goal != null ? { carbsGoal: row.carbs_goal } : {}),
    appetite: n(row.appetite) ?? 1,
    shareDiary: Boolean(row.share_diary),
  };
}

function mealToRow(meal: Meal) {
  return {
    id: meal.id,
    user_id: meal.ownerId,
    recipe_id: meal.recipeId && isUuid(meal.recipeId) ? meal.recipeId : null,
    title: meal.title.slice(0, 120),
    emoji: meal.emoji.slice(0, 16),
    servings: Math.min(50, Math.max(0.25, meal.servings)),
    ...nutritionColumns(meal.nutrition),
    items: meal.items,
    note: meal.note?.slice(0, 300) ?? null,
    cooked_at: meal.cookedAt,
    finished: meal.finished,
    ...takenColumn(meal.pantryTaken),
  };
}

function entryToRow(entry: FoodEntry) {
  return {
    id: entry.id,
    user_id: entry.userId,
    eaten_at: entry.eatenAt,
    slot: entry.slot,
    title: entry.title.slice(0, 160),
    emoji: entry.emoji.slice(0, 16),
    product_id: entry.productId && isUuid(entry.productId) ? entry.productId : null,
    meal_id: entry.mealId ?? null,
    share: entry.share ?? null,
    grams: entry.grams != null ? Math.round(entry.grams * 10) / 10 : null,
    ...nutritionColumns(entry.nutrition),
    source: entry.source,
    ...takenColumn(entry.pantryTaken),
  };
}

/**
 * Upsert пачкою пише ті самі колонки для всіх рядків, а відсутня стає null.
 * Тому рядки з pantry_taken і без неї — окремими запитами.
 */
function byTakenColumn<T extends object>(rows: T[]): T[][] {
  const withTaken = rows.filter((r) => "pantry_taken" in r);
  const without = rows.filter((r) => !("pantry_taken" in r));
  return [withTaken, without].filter((group) => group.length > 0);
}

/* ── Читання ──────────────────────────────────────────────────────────── */

export interface RemoteDiary {
  entries: FoodEntry[];
  meals: Meal[];
  settings: DiarySettings[];
}

/**
 * Усе, що треба щоденнику: свої записи (і ті, що сімʼя відкрила), страви
 * сімʼї й налаштування всіх у сімʼї. Видимість записів вирішує RLS — тут
 * обмежуємо лише часом.
 */
export async function fetchDiary(memberIds: readonly string[]): Promise<RemoteDiary | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const since = new Date(Date.now() - DIARY_DAYS * 24 * 3600_000).toISOString();

  const [entries, meals, settings] = await Promise.all([
    sb.from("food_log").select(FOOD_SELECT).gte("eaten_at", since).order("eaten_at", { ascending: false }).limit(2000),
    sb
      .from("meals")
      .select(MEAL_SELECT)
      .in("user_id", [...memberIds])
      .gte("cooked_at", since)
      .order("cooked_at", { ascending: false })
      .limit(500),
    sb
      .from("diary_settings")
      .select("user_id,kcal_goal,protein_goal,fat_goal,carbs_goal,appetite,share_diary")
      .in("user_id", [...memberIds]),
  ]);
  const error = entries.error ?? meals.error ?? settings.error;
  if (error) throw error;

  return {
    entries: ((entries.data ?? []) as unknown as FoodRow[]).map(rowToEntry),
    meals: ((meals.data ?? []) as unknown as MealRow[]).map(rowToMeal),
    settings: ((settings.data ?? []) as unknown as SettingsRow[]).map(rowToSettings),
  };
}

/* ── Запис ────────────────────────────────────────────────────────────── */

export async function upsertMeals(meals: readonly Meal[]): Promise<void> {
  const sb = getSupabase();
  const rows = meals.filter((m) => isUuid(m.id)).map(mealToRow);
  if (!sb || rows.length === 0) return;
  for (const group of byTakenColumn(rows)) {
    const { error } = await sb.from("meals").upsert(group, { onConflict: "id" });
    if (error) throw error;
  }
}

export async function deleteMeal(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || !isUuid(id)) return;
  const { error } = await sb.from("meals").delete().eq("id", id);
  if (error) throw error;
}

export async function upsertEntries(entries: readonly FoodEntry[]): Promise<void> {
  const sb = getSupabase();
  const rows = entries.filter((e) => isUuid(e.id)).map(entryToRow);
  if (!sb || rows.length === 0) return;
  for (const group of byTakenColumn(rows)) {
    const { error } = await sb.from("food_log").upsert(group, { onConflict: "id" });
    if (error) throw error;
  }
}

export async function deleteEntries(ids: readonly string[]): Promise<void> {
  const sb = getSupabase();
  const list = ids.filter(isUuid);
  if (!sb || list.length === 0) return;
  const { error } = await sb.from("food_log").delete().in("id", list);
  if (error) throw error;
}

export async function saveDiarySettings(settings: DiarySettings): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("diary_settings").upsert(
    {
      user_id: settings.userId,
      kcal_goal: settings.kcalGoal ?? null,
      protein_goal: settings.proteinGoal ?? null,
      fat_goal: settings.fatGoal ?? null,
      carbs_goal: settings.carbsGoal ?? null,
      appetite: Math.min(4, Math.max(0.25, settings.appetite)),
      share_diary: settings.shareDiary,
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

/* ── Ключі голосового помічника ───────────────────────────────────────── */

export interface ApiToken {
  id: string;
  label: string;
  hint: string;
  createdAt: string;
  lastUsedAt?: string;
}

export async function listApiTokens(): Promise<ApiToken[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("api_tokens")
    .select("id,label,hint,created_at,last_used_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, string | null>>).map((row) => ({
    id: String(row.id),
    label: String(row.label),
    hint: String(row.hint),
    createdAt: String(row.created_at),
    ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
  }));
}

/** Новий ключ. Сам ключ база віддає один раз — потім лишається лише його хеш. */
export async function createApiToken(label: string): Promise<{ token: ApiToken; secret: string }> {
  const sb = getSupabase();
  if (!sb) throw new Error("Потрібен бекенд");
  const { data, error } = await sb.rpc("create_api_token", { p_label: label });
  if (error) throw error;
  const row = data as Record<string, string>;
  return {
    token: { id: row.id, label: row.label, hint: row.hint, createdAt: row.created_at },
    secret: row.token,
  };
}

export async function deleteApiToken(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("api_tokens").delete().eq("id", id);
  if (error) throw error;
}
