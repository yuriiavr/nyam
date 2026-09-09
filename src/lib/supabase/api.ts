"use client";

import { getSupabase } from "./client";
import type {
  CookEvent,
  PantryItem,
  PlanSlot,
  Profile,
  Recipe,
  RecipeIngredient,
  RecipeStep,
  WeekPlan,
} from "@/lib/types";

/* ── Рядки бази ───────────────────────────────────────────────────────── */

interface RecipeRow {
  id: string;
  author_id: string;
  title: string;
  description: string;
  emoji: string;
  gradient: string[] | null;
  image_url: string | null;
  cuisine: string;
  meal_types: string[] | null;
  moods: string[] | null;
  tags: string[] | null;
  time_min: number;
  difficulty: number;
  servings: number;
  kcal: number | null;
  cost_level: number;
  ingredients: RecipeIngredient[] | null;
  steps: RecipeStep[] | null;
  source_id: string | null;
  created_at: string;
  likes?: number;
  saves?: number;
  cooks?: number;
  rating_sum?: number;
  rating_count?: number;
}

interface ProfileRow {
  id: string;
  handle: string;
  name: string;
  emoji: string;
  gradient: string[] | null;
  bio: string;
  city: string | null;
  avatar_url: string | null;
  followers?: number;
}

const RECIPE_COLUMNS =
  "id,author_id,title,description,emoji,gradient,image_url,cuisine,meal_types,moods," +
  "tags,time_min,difficulty,servings,kcal,cost_level,ingredients,steps,source_id," +
  "created_at,likes,saves,cooks,rating_sum,rating_count";

/* ── Перетворення ─────────────────────────────────────────────────────── */

const pair = (value: string[] | null, fallback: [string, string]): [string, string] =>
  value && value.length >= 2 ? [value[0], value[1]] : fallback;

export function rowToRecipe(row: RecipeRow, myId?: string | null): Recipe {
  return {
    id: row.id,
    authorId: row.author_id,
    title: row.title,
    description: row.description ?? "",
    emoji: row.emoji || "🍽️",
    gradient: pair(row.gradient, ["#ff6b35", "#ffb020"]),
    image: row.image_url,
    cuisine: row.cuisine || "Домашня",
    mealTypes: (row.meal_types ?? []) as Recipe["mealTypes"],
    moods: (row.moods ?? []) as Recipe["moods"],
    tags: row.tags ?? [],
    timeMin: row.time_min,
    difficulty: (row.difficulty as 1 | 2 | 3) ?? 1,
    servings: row.servings,
    kcal: row.kcal ?? undefined,
    costLevel: (row.cost_level as 1 | 2 | 3) ?? 1,
    ingredients: row.ingredients ?? [],
    steps: row.steps ?? [],
    createdAt: row.created_at,
    sourceId: row.source_id ?? undefined,
    mine: myId ? row.author_id === myId : undefined,
    stats: {
      likes: row.likes ?? 0,
      saves: row.saves ?? 0,
      cooks: row.cooks ?? 0,
      ratingSum: row.rating_sum ?? 0,
      ratingCount: row.rating_count ?? 0,
    },
  };
}

export function rowToProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    emoji: row.emoji || "🧑‍🍳",
    gradient: pair(row.gradient, ["#ff6b35", "#ffb020"]),
    bio: row.bio ?? "",
    city: row.city ?? undefined,
    avatar: row.avatar_url,
    followers: row.followers ?? 0,
  };
}

/** Поля рецепта для запису — статистика рахується базою, тож її не шлемо. */
export function recipeToRow(recipe: Recipe, authorId: string) {
  return {
    id: recipe.id,
    author_id: authorId,
    title: recipe.title,
    description: recipe.description,
    emoji: recipe.emoji,
    gradient: recipe.gradient,
    image_url: recipe.image ?? null,
    cuisine: recipe.cuisine,
    meal_types: recipe.mealTypes,
    moods: recipe.moods,
    tags: recipe.tags,
    time_min: recipe.timeMin,
    difficulty: recipe.difficulty,
    servings: recipe.servings,
    kcal: recipe.kcal ?? null,
    cost_level: recipe.costLevel,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    source_id: recipe.sourceId ?? null,
  };
}

/* ── Читання ──────────────────────────────────────────────────────────── */

export interface RemoteSnapshot {
  profile: Profile | null;
  profiles: Profile[];
  recipes: Recipe[];
  myRecipes: Recipe[];
  likes: string[];
  saves: string[];
  wishlist: string[];
  dismissed: string[];
  ratings: Record<string, number>;
  cooked: CookEvent[];
  following: string[];
  pantry: PantryItem[];
  plan: WeekPlan;
}

/** Публічний контент — потрібен і гостям, і авторизованим. */
export async function fetchCommunity(
  myId: string | null,
  limit = 400,
): Promise<{ recipes: Recipe[]; profiles: Profile[] }> {
  const sb = getSupabase();
  if (!sb) return { recipes: [], profiles: [] };

  const [recipesRes, profilesRes] = await Promise.all([
    sb
      .from("recipes_with_stats")
      .select(RECIPE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(limit),
    sb.from("profiles_with_counts").select("id,handle,name,emoji,gradient,bio,city,avatar_url,followers"),
  ]);

  if (recipesRes.error) throw recipesRes.error;
  if (profilesRes.error) throw profilesRes.error;

  return {
    recipes: (recipesRes.data as unknown as RecipeRow[]).map((r) => rowToRecipe(r, myId)),
    profiles: (profilesRes.data as unknown as ProfileRow[]).map(rowToProfile),
  };
}

/** Усе, що стосується конкретного користувача. */
export async function fetchUserState(userId: string) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase не налаштовано");

  const [likes, saves, wishlist, dismissed, ratings, cooks, follows, pantry, plan, profile] =
    await Promise.all([
      sb.from("likes").select("recipe_id").eq("user_id", userId),
      sb.from("saves").select("recipe_id").eq("user_id", userId),
      sb.from("wishlist").select("recipe_id").eq("user_id", userId),
      sb.from("dismissed").select("recipe_id").eq("user_id", userId),
      sb.from("ratings").select("recipe_id,stars").eq("user_id", userId),
      sb
        .from("cooks")
        .select("recipe_id,cooked_at")
        .eq("user_id", userId)
        .order("cooked_at", { ascending: false })
        .limit(400),
      sb.from("follows").select("followee_id").eq("follower_id", userId),
      sb.from("pantry_items").select("ingredient_key,label,qty,barcode,added_at").eq("user_id", userId),
      sb.from("plan_slots").select("day,slot,recipe_id").eq("user_id", userId),
      sb
        .from("profiles_with_counts")
        .select("id,handle,name,emoji,gradient,bio,city,avatar_url,followers")
        .eq("id", userId)
        .maybeSingle(),
    ]);

  const firstError = [likes, saves, wishlist, dismissed, ratings, cooks, follows, pantry, plan, profile]
    .map((r) => r.error)
    .find(Boolean);
  if (firstError) throw firstError;

  const planMap: WeekPlan = {};
  for (const row of (plan.data ?? []) as Array<{ day: string; slot: PlanSlot; recipe_id: string }>) {
    planMap[row.day] = { ...(planMap[row.day] ?? {}), [row.slot]: row.recipe_id };
  }

  return {
    profile: profile.data ? rowToProfile(profile.data as unknown as ProfileRow) : null,
    likes: (likes.data ?? []).map((r) => (r as { recipe_id: string }).recipe_id),
    saves: (saves.data ?? []).map((r) => (r as { recipe_id: string }).recipe_id),
    wishlist: (wishlist.data ?? []).map((r) => (r as { recipe_id: string }).recipe_id),
    dismissed: (dismissed.data ?? []).map((r) => (r as { recipe_id: string }).recipe_id),
    ratings: Object.fromEntries(
      (ratings.data ?? []).map((r) => {
        const row = r as { recipe_id: string; stars: number };
        return [row.recipe_id, row.stars];
      }),
    ) as Record<string, number>,
    cooked: (cooks.data ?? []).map((r) => {
      const row = r as { recipe_id: string; cooked_at: string };
      return { recipeId: row.recipe_id, at: row.cooked_at };
    }) as CookEvent[],
    following: (follows.data ?? []).map((r) => (r as { followee_id: string }).followee_id),
    pantry: (pantry.data ?? []).map((r) => {
      const row = r as {
        ingredient_key: string;
        label: string | null;
        qty: string | null;
        barcode: string | null;
        added_at: string;
      };
      return {
        key: row.ingredient_key,
        label: row.label ?? undefined,
        qty: row.qty ?? undefined,
        barcode: row.barcode ?? undefined,
        addedAt: row.added_at,
      };
    }) as PantryItem[],
    plan: planMap,
  };
}

/* ── Запис ────────────────────────────────────────────────────────────── */

export async function upsertRecipe(recipe: Recipe, authorId: string) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("recipes").upsert(recipeToRow(recipe, authorId));
  if (error) throw error;
}

export async function deleteRecipe(id: string) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("recipes").delete().eq("id", id);
  if (error) throw error;
}

/** Вмикає/вимикає запис у таблиці-звʼязці (likes, saves, wishlist, dismissed). */
export async function setRelation(
  table: "likes" | "saves" | "wishlist" | "dismissed",
  userId: string,
  recipeId: string,
  on: boolean,
) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = on
    ? await sb.from(table).upsert({ user_id: userId, recipe_id: recipeId })
    : await sb.from(table).delete().eq("user_id", userId).eq("recipe_id", recipeId);
  if (error) throw error;
}

export async function setRating(userId: string, recipeId: string, stars: number) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("ratings")
    .upsert({ user_id: userId, recipe_id: recipeId, stars });
  if (error) throw error;
}

export async function addCook(userId: string, recipeId: string, at: string) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("cooks")
    .insert({ user_id: userId, recipe_id: recipeId, cooked_at: at });
  if (error) throw error;
}

export async function setFollow(followerId: string, followeeId: string, on: boolean) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = on
    ? await sb.from("follows").upsert({ follower_id: followerId, followee_id: followeeId })
    : await sb
        .from("follows")
        .delete()
        .eq("follower_id", followerId)
        .eq("followee_id", followeeId);
  if (error) throw error;
}

export async function upsertPantryItem(userId: string, item: PantryItem) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("pantry_items").upsert({
    user_id: userId,
    ingredient_key: item.key,
    label: item.label ?? null,
    qty: item.qty ?? null,
    barcode: item.barcode ?? null,
    added_at: item.addedAt,
  });
  if (error) throw error;
}

export async function deletePantryItem(userId: string, key: string) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("pantry_items")
    .delete()
    .eq("user_id", userId)
    .eq("ingredient_key", key);
  if (error) throw error;
}

export async function clearPantry(userId: string) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("pantry_items").delete().eq("user_id", userId);
  if (error) throw error;
}

export async function setPlanSlot(
  userId: string,
  day: string,
  slot: PlanSlot,
  recipeId: string | null,
) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = recipeId
    ? await sb.from("plan_slots").upsert({ user_id: userId, day, slot, recipe_id: recipeId })
    : await sb.from("plan_slots").delete().eq("user_id", userId).eq("day", day).eq("slot", slot);
  if (error) throw error;
}

export async function updateProfile(userId: string, patch: Partial<Profile>) {
  const sb = getSupabase();
  if (!sb) return;
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.handle !== undefined) row.handle = patch.handle;
  if (patch.bio !== undefined) row.bio = patch.bio;
  if (patch.emoji !== undefined) row.emoji = patch.emoji;
  if (patch.city !== undefined) row.city = patch.city;
  if (patch.gradient !== undefined) row.gradient = patch.gradient;
  if (patch.avatar !== undefined) row.avatar_url = patch.avatar;
  if (!Object.keys(row).length) return;

  const { error } = await sb.from("profiles").update(row).eq("id", userId);
  if (error) throw error;
}

/* ── Сховище фото ─────────────────────────────────────────────────────── */

/** Завантажує data:URL у бакет recipe-images і повертає публічне посилання. */
export async function uploadRecipeImage(
  userId: string,
  dataUrl: string,
  recipeId: string,
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase не налаштовано");

  const blob = await (await fetch(dataUrl)).blob();
  const path = `${userId}/${recipeId}.jpg`;

  const { error } = await sb.storage.from("recipe-images").upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: true,
  });
  if (error) throw error;

  return sb.storage.from("recipe-images").getPublicUrl(path).data.publicUrl;
}

/** Масове очищення — для «повернути приховані» та «очистити план». */
export async function clearRelation(
  table: "likes" | "saves" | "wishlist" | "dismissed",
  userId: string,
) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from(table).delete().eq("user_id", userId);
  if (error) throw error;
}

export async function clearPlan(userId: string) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("plan_slots").delete().eq("user_id", userId);
  if (error) throw error;
}

/** Власні рецепти користувача — включно з тими, що не потрапили у вибірку стрічки. */
export async function fetchMyRecipes(userId: string): Promise<Recipe[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("recipes_with_stats")
    .select(RECIPE_COLUMNS)
    .eq("author_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as RecipeRow[]).map((r) => rowToRecipe(r, userId));
}
