"use client";

import { getSupabase } from "./client";
import type {
  AppNotification,
  CookEvent,
  Family,
  FamilyMember,
  IngredientDef,
  Nutrition,
  PantryItem,
  PlanSlot,
  Profile,
  Recipe,
  RecipeComment,
  RecipeIngredient,
  RecipeStep,
  ShoppingItem,
  Unit,
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

/** numeric з postgrest приїжджає рядком — зводимо до числа або нічого. */
function numberOrUndefined(value: number | string | null): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Рядок комори так, як він лежить у базі. */
interface PantryRow {
  ingredient_key: string;
  label: string | null;
  amount: number | string | null;
  unit: string | null;
  qty: string | null;
  barcode: string | null;
  added_at: string;
  expires_at: string | null;
  price_per_gram: number | string | null;
}

/**
 * Колонки комори для select.
 *
 * Список виводимо з типу рядка, а не пишемо окремим текстом. Так було не
 * завжди, і це коштувало реального бага: у таблицю додали amount і unit,
 * запис їх зберігав, тип рядка про них знав, а рядок select лишився старим.
 * Кількість, яку щойно ввели, зникала при першому ж перечитуванні — і ні
 * типи, ні збірка цього не бачили, бо перелік колонок був просто текстом.
 *
 * `satisfies Record<keyof PantryRow, true>` вимагає перелічити геть усі поля:
 * додати колонку в тип і забути тут більше не вийде — не збереться.
 */
const PANTRY_COLUMNS = {
  ingredient_key: true,
  label: true,
  amount: true,
  unit: true,
  qty: true,
  barcode: true,
  added_at: true,
  expires_at: true,
  price_per_gram: true,
} satisfies Record<keyof PantryRow, true>;

export const PANTRY_SELECT = Object.keys(PANTRY_COLUMNS).join(",");

/** Рядок списку покупок так, як він лежить у базі. */
interface ShoppingRow {
  id: string;
  user_id: string;
  ingredient_key: string | null;
  text: string | null;
  amount: number | string | null;
  unit: string | null;
  done: boolean;
  added_at: string;
  source: string | null;
  recipe_id: string | null;
}

/** Ті самі правила, що й для комори: перелік колонок виводиться з типу. */
const SHOPPING_COLUMNS = {
  id: true,
  user_id: true,
  ingredient_key: true,
  text: true,
  amount: true,
  unit: true,
  done: true,
  added_at: true,
  source: true,
  recipe_id: true,
} satisfies Record<keyof ShoppingRow, true>;

export const SHOPPING_SELECT = Object.keys(SHOPPING_COLUMNS).join(",");

/**
 * Ідентифікатор рецепта пишемо лише тоді, коли він справді з бази.
 *
 * Поки спільнота не завантажилась, застосунок показує демо-набір, де в
 * рецептів ключі на кшталт «r_borsch». Такий рядок Postgres у колонку uuid
 * не прийме, і додавання в список впало б з помилкою просто тому, що людина
 * відкрила знайомий рецепт офлайн. Підпис «для „Борщу“» від цього зникає —
 * але сама покупка лишається, а це головне.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shoppingToRow(userId: string, item: ShoppingItem) {
  return {
    id: item.id,
    /*
     * Власник — той, хто рядок створив, а не той, хто його зараз чіпає.
     * Ключ таблиці — сам рядок, тож upsert без цього переписував би user_id
     * на кожній галочці, і покупки, додані однією людиною, при виході з
     * сімʼї пішли б за іншою.
     */
    user_id: item.ownerId ?? userId,
    ingredient_key: item.key ?? null,
    text: item.text ?? null,
    amount: item.amount ?? null,
    unit: item.unit ?? null,
    done: item.done,
    added_at: item.addedAt,
    source: item.source ?? null,
    recipe_id: item.recipeId && UUID_RE.test(item.recipeId) ? item.recipeId : null,
  };
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
  shopping: ShoppingItem[];
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

/** Один продукт на ingredient_key: перемагає той, кого додали раніше. */
function dedupePantry(items: PantryItem[]): PantryItem[] {
  const byKey = new Map<string, PantryItem>();
  for (const item of items) {
    const seen = byKey.get(item.key);
    if (!seen || item.addedAt < seen.addedAt) byKey.set(item.key, item);
  }
  return [...byKey.values()];
}

/**
 * Усе, що стосується користувача. `memberIds` — усі учасники його сімʼї
 * (включно з ним самим); спільні сутності читаються по цьому списку, а суто
 * особисті — лайки, оцінки, історія готувань, приховане, підписки — ні.
 */
export async function fetchUserState(userId: string, memberIds: string[] = [userId]) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase не налаштовано");

  const shared = memberIds.length ? memberIds : [userId];

  const [likes, saves, wishlist, dismissed, ratings, cooks, follows, pantry, shopping, plan, profile] =
    await Promise.all([
      sb.from("likes").select("recipe_id").eq("user_id", userId),
      sb.from("saves").select("recipe_id").in("user_id", shared),
      sb.from("wishlist").select("recipe_id").in("user_id", shared),
      sb.from("dismissed").select("recipe_id").eq("user_id", userId),
      sb.from("ratings").select("recipe_id,stars").eq("user_id", userId),
      sb
        .from("cooks")
        .select("recipe_id,cooked_at")
        .eq("user_id", userId)
        .order("cooked_at", { ascending: false })
        .limit(400),
      sb.from("follows").select("followee_id").eq("follower_id", userId),
      sb
        .from("pantry_items")
        .select(PANTRY_SELECT)
        .in("user_id", shared),
      sb
        .from("shopping_items")
        .select(SHOPPING_SELECT)
        .in("user_id", shared)
        .order("added_at", { ascending: false }),
      sb.from("plan_slots").select("day,slot,recipe_id").in("user_id", shared),
      sb
        .from("profiles_with_counts")
        .select("id,handle,name,emoji,gradient,bio,city,avatar_url,followers")
        .eq("id", userId)
        .maybeSingle(),
    ]);

  const firstError = [likes, saves, wishlist, dismissed, ratings, cooks, follows, pantry, shopping, plan, profile]
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
    // Спільні списки сімʼї: двоє могли зберегти той самий рецепт.
    saves: [...new Set((saves.data ?? []).map((r) => (r as { recipe_id: string }).recipe_id))],
    wishlist: [...new Set((wishlist.data ?? []).map((r) => (r as { recipe_id: string }).recipe_id))],
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
    // Комора сімʼї — обʼєднання комор учасників. Один продукт могли додати
    // двоє, тож лишаємо найраніший запис на кожен ingredient_key.
    pantry: dedupePantry(
      (pantry.data ?? []).map((r) => {
        // Через unknown, бо select зібрано з PANTRY_COLUMNS, а не заданий
        // рядковим літералом — вивести форму рядка supabase-js уже не може.
        const row = r as unknown as PantryRow;
        // amount приїжджає з numeric — postgrest віддає його рядком.
        const amount = numberOrUndefined(row.amount);
        return {
          key: row.ingredient_key,
          label: row.label ?? undefined,
          amount,
          unit: (row.unit as PantryItem["unit"]) ?? undefined,
          qty: row.qty ?? undefined,
          barcode: row.barcode ?? undefined,
          addedAt: row.added_at,
          expiresAt: row.expires_at ?? undefined,
          pricePerGram: numberOrUndefined(row.price_per_gram),
        };
      }),
    ),
    // Список покупок у сімʼї спільний, і зводити рядки не треба: дві пачки
    // молока, додані двома людьми, — це не помилка, а два рядки, за якими
    // видно, що обоє про нього подумали.
    shopping: ((shopping.data ?? []) as unknown as ShoppingRow[]).map((row) => ({
      id: row.id,
      ownerId: row.user_id,
      key: row.ingredient_key ?? undefined,
      text: row.text ?? undefined,
      amount: numberOrUndefined(row.amount),
      unit: (row.unit as ShoppingItem["unit"]) ?? undefined,
      done: row.done,
      addedAt: row.added_at,
      source: (row.source as ShoppingItem["source"]) ?? undefined,
      recipeId: row.recipe_id ?? undefined,
    })),
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
  memberIds: string[] = [userId],
) {
  const sb = getSupabase();
  if (!sb) return;
  // Прибрати зі спільного списку сімʼї має право будь-хто з неї; лайки та
  // приховане лишаються особистими, їх чіпаємо тільки свої.
  const scope = table === "saves" || table === "wishlist" ? memberIds : [userId];
  const { error } = on
    ? await sb.from(table).upsert({ user_id: userId, recipe_id: recipeId })
    : await sb
        .from(table)
        .delete()
        .in("user_id", scope.length ? scope : [userId])
        .eq("recipe_id", recipeId);
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
    amount: item.amount ?? null,
    unit: item.unit ?? null,
    qty: item.qty ?? null,
    barcode: item.barcode ?? null,
    added_at: item.addedAt,
    expires_at: item.expiresAt ?? null,
    price_per_gram: item.pricePerGram ?? null,
  });
  if (error) throw error;
}

/**
 * Записує одразу кілька продуктів — так у комору лягає цілий чек.
 *
 * Окремо від upsertPantryItem, бо двадцять позицій двадцятьма запитами — це
 * і двадцять кругів до бази, і двадцять подій realtime у кожного в сімʼї.
 */
export async function upsertPantryItems(userId: string, items: PantryItem[]) {
  const sb = getSupabase();
  if (!sb || items.length === 0) return;
  const { error } = await sb.from("pantry_items").upsert(
    items.map((item) => ({
      user_id: userId,
      ingredient_key: item.key,
      label: item.label ?? null,
      amount: item.amount ?? null,
      unit: item.unit ?? null,
      qty: item.qty ?? null,
      barcode: item.barcode ?? null,
      added_at: item.addedAt,
      expires_at: item.expiresAt ?? null,
      price_per_gram: item.pricePerGram ?? null,
    })),
  );
  if (error) throw error;
}

/** Дописує або оновлює рядки списку покупок — пачкою, як і комора. */
export async function upsertShoppingItems(userId: string, items: ShoppingItem[]) {
  const sb = getSupabase();
  if (!sb || items.length === 0) return;
  const { error } = await sb
    .from("shopping_items")
    .upsert(items.map((item) => shoppingToRow(userId, item)));
  if (error) throw error;
}

/**
 * Прибирає рядки списку — зокрема ті, які додав хтось інший із сімʼї.
 *
 * Ідентифікатор рядка свій власний, тож обмеження по user_id тут не для
 * пошуку, а щоб запит не міг зачепити нічого поза сімʼєю.
 */
export async function deleteShoppingItems(
  userId: string,
  ids: string[],
  memberIds: string[] = [userId],
) {
  const sb = getSupabase();
  if (!sb || ids.length === 0) return;
  const { error } = await sb
    .from("shopping_items")
    .delete()
    .in("user_id", memberIds.length ? memberIds : [userId])
    .in("id", ids);
  if (error) throw error;
}

/** Прибирає продукт з комори — і з тієї частини, яку додав хтось із сімʼї. */
export async function deletePantryItem(
  userId: string,
  key: string,
  memberIds: string[] = [userId],
) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("pantry_items")
    .delete()
    .in("user_id", memberIds.length ? memberIds : [userId])
    .eq("ingredient_key", key);
  if (error) throw error;
}

export async function clearPantry(userId: string, memberIds: string[] = [userId]) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("pantry_items")
    .delete()
    .in("user_id", memberIds.length ? memberIds : [userId]);
  if (error) throw error;
}

/**
 * Ставить страву в слот плану.
 *
 * Ключ таблиці — (user_id, day, slot), тож у сімʼї двоє могли б записати різні
 * страви на ту саму вечерю і план став би неоднозначним. Тому перед записом
 * чистимо цей слот у решти учасників: слот один на сімʼю, останній запис
 * перемагає.
 */
export async function setPlanSlot(
  userId: string,
  day: string,
  slot: PlanSlot,
  recipeId: string | null,
  memberIds: string[] = [userId],
) {
  const sb = getSupabase();
  if (!sb) return;
  const family = memberIds.length ? memberIds : [userId];

  const others = family.filter((id) => id !== userId);
  if (others.length) {
    const { error: clashError } = await sb
      .from("plan_slots")
      .delete()
      .in("user_id", others)
      .eq("day", day)
      .eq("slot", slot);
    if (clashError) throw clashError;
  }

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
  memberIds: string[] = [userId],
) {
  const sb = getSupabase();
  if (!sb) return;
  // saves і wishlist спільні для сімʼї, likes і dismissed — особисті.
  const scope = table === "saves" || table === "wishlist" ? memberIds : [userId];
  const { error } = await sb
    .from(table)
    .delete()
    .in("user_id", scope.length ? scope : [userId]);
  if (error) throw error;
}

export async function clearPlan(userId: string, memberIds: string[] = [userId]) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("plan_slots")
    .delete()
    .in("user_id", memberIds.length ? memberIds : [userId]);
  if (error) throw error;
}

/** Власні рецепти користувача — включно з тими, що не потрапили у вибірку стрічки. */
/**
 * Власні рецепти, а разом з ними — рецепти решти сімʼї.
 * `authorIds` за замовчуванням містить лише самого користувача, тож поведінка
 * для тих, хто не в сімʼї, не змінюється.
 */
export async function fetchMyRecipes(
  userId: string,
  authorIds: string[] = [userId],
): Promise<Recipe[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const ids = authorIds.length ? authorIds : [userId];
  const { data, error } = await sb
    .from("recipes_with_stats")
    .select(RECIPE_COLUMNS)
    .in("author_id", ids)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as RecipeRow[]).map((r) => rowToRecipe(r, userId));
}

/* ── Сімʼя ────────────────────────────────────────────────────────────── */

const PROFILE_COLUMNS = "id,handle,name,emoji,gradient,bio,city,avatar_url,followers";

interface FamilyRow {
  id: string;
  invite_code: string;
  created_by: string | null;
  created_at: string;
}

function rowToFamily(row: FamilyRow): Family {
  return {
    id: row.id,
    inviteCode: row.invite_code,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** Сімʼя поточного користувача разом з учасниками. null — сімʼї немає. */
export async function fetchFamily(): Promise<{ family: Family; members: FamilyMember[] } | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data: famRows, error: famError } = await sb
    .from("families")
    .select("id,invite_code,created_by,created_at")
    .limit(1);
  if (famError) throw famError;
  if (!famRows?.length) return null;

  const family = rowToFamily(famRows[0] as unknown as FamilyRow);

  const { data: memberRows, error: memberError } = await sb
    .from("family_members")
    .select("user_id,role,joined_at")
    .order("joined_at");
  if (memberError) throw memberError;

  const ids = (memberRows ?? []).map((m) => (m as { user_id: string }).user_id);
  if (!ids.length) return { family, members: [] };

  const { data: profileRows, error: profileError } = await sb
    .from("profiles_with_counts")
    .select(PROFILE_COLUMNS)
    .in("id", ids);
  if (profileError) throw profileError;

  const byId = new Map(
    (profileRows as unknown as ProfileRow[]).map((p) => [p.id, rowToProfile(p)] as const),
  );

  const members = (memberRows ?? [])
    .map((m) => {
      const row = m as { user_id: string; role: "owner" | "member"; joined_at: string };
      const profile = byId.get(row.user_id);
      if (!profile) return null;
      return { userId: row.user_id, role: row.role, joinedAt: row.joined_at, profile };
    })
    .filter((m): m is FamilyMember => m !== null);

  return { family, members };
}

export async function createFamily(): Promise<Family> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase не налаштовано");
  const { data, error } = await sb.rpc("create_family");
  if (error) throw error;
  return rowToFamily(data as unknown as FamilyRow);
}

export async function joinFamily(code: string): Promise<Family> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase не налаштовано");
  const { data, error } = await sb.rpc("join_family", { code });
  if (error) throw error;
  return rowToFamily(data as unknown as FamilyRow);
}

export async function leaveFamily(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("leave_family");
  if (error) throw error;
}

export async function removeFamilyMember(target: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("remove_family_member", { target });
  if (error) throw error;
}

/* ── Сповіщення ───────────────────────────────────────────────────────── */

export async function fetchNotifications(limit = 100): Promise<AppNotification[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("notifications")
    .select("id,type,actor_id,recipe_id,read_at,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((n) => {
    const row = n as {
      id: string;
      type: AppNotification["type"];
      actor_id: string | null;
      recipe_id: string | null;
      read_at: string | null;
      created_at: string;
    };
    return {
      id: row.id,
      type: row.type,
      actorId: row.actor_id,
      recipeId: row.recipe_id,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  });
}

export async function markNotificationsRead(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.rpc("mark_notifications_read");
  if (error) throw error;
}

/* ── Підписники й пошук кухарів ───────────────────────────────────────── */

/** Хто підписався на цього користувача. */
export async function fetchFollowers(userId: string): Promise<Profile[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("follows")
    .select("follower_id")
    .eq("followee_id", userId);
  if (error) throw error;

  const ids = (data ?? []).map((f) => (f as { follower_id: string }).follower_id);
  if (!ids.length) return [];

  const { data: profiles, error: profileError } = await sb
    .from("profiles_with_counts")
    .select(PROFILE_COLUMNS)
    .in("id", ids);
  if (profileError) throw profileError;
  return (profiles as unknown as ProfileRow[]).map(rowToProfile);
}

/** На кого підписаний цей користувач. */
export async function fetchFollowing(userId: string): Promise<Profile[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("follows")
    .select("followee_id")
    .eq("follower_id", userId);
  if (error) throw error;

  const ids = (data ?? []).map((f) => (f as { followee_id: string }).followee_id);
  if (!ids.length) return [];

  const { data: profiles, error: profileError } = await sb
    .from("profiles_with_counts")
    .select(PROFILE_COLUMNS)
    .in("id", ids);
  if (profileError) throw profileError;
  return (profiles as unknown as ProfileRow[]).map(rowToProfile);
}

/**
 * Пошук кухаря за ніком або імʼям. Шукаємо на сервері, а не серед уже
 * завантажених профілів: у вибірку стрічки потрапляють не всі.
 */
export async function searchProfiles(query: string, limit = 30): Promise<Profile[]> {
  const sb = getSupabase();
  const q = query.trim();
  if (!sb || q.length < 2) return [];

  // Екрануємо символи, які PostgREST тлумачить структурно.
  const safe = q.replace(/[,()*%\\]/g, " ").trim();
  if (!safe) return [];

  const { data, error } = await sb
    .from("profiles_with_counts")
    .select(PROFILE_COLUMNS)
    .or(`handle.ilike.%${safe}%,name.ilike.%${safe}%`)
    .order("followers", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as unknown as ProfileRow[]).map(rowToProfile);
}

/** Профілі за списком id — щоб показати, хто саме зробив дію у сповіщенні. */
export async function fetchProfilesByIds(ids: string[]): Promise<Profile[]> {
  const sb = getSupabase();
  const unique = [...new Set(ids)].filter(Boolean);
  if (!sb || !unique.length) return [];
  const { data, error } = await sb
    .from("profiles_with_counts")
    .select(PROFILE_COLUMNS)
    .in("id", unique);
  if (error) throw error;
  return (data as unknown as ProfileRow[]).map(rowToProfile);
}

/* ── Продукти, дописані людьми ────────────────────────────────────────── */

interface CustomIngredientRow {
  key: string;
  label: string;
  emoji: string;
  cat: string;
  aliases: string[] | null;
  staple: boolean;
  grams_per_piece: number | string | null;
  grams_per_cup: number | string | null;
  default_unit: string;
  kcal: number | string | null;
  protein: number | string | null;
  fat: number | string | null;
  carbs: number | string | null;
}

const CUSTOM_INGREDIENT_COLUMNS = {
  key: true,
  label: true,
  emoji: true,
  cat: true,
  aliases: true,
  staple: true,
  grams_per_piece: true,
  grams_per_cup: true,
  default_unit: true,
  kcal: true,
  protein: true,
  fat: true,
  carbs: true,
} satisfies Record<keyof CustomIngredientRow, true>;

const CUSTOM_INGREDIENT_SELECT = Object.keys(CUSTOM_INGREDIENT_COLUMNS).join(",");

function rowToIngredient(row: CustomIngredientRow): IngredientDef {
  const kcal = numberOrUndefined(row.kcal);
  return {
    key: row.key,
    label: row.label,
    emoji: row.emoji,
    cat: row.cat as IngredientDef["cat"],
    aliases: row.aliases ?? [],
    staple: row.staple,
    gramsPerPiece: numberOrUndefined(row.grams_per_piece),
    gramsPerCup: numberOrUndefined(row.grams_per_cup),
    defaultUnit: row.default_unit as Unit,
    nutrition:
      kcal != null
        ? {
            kcal,
            protein: numberOrUndefined(row.protein) ?? 0,
            fat: numberOrUndefined(row.fat) ?? 0,
            carbs: numberOrUndefined(row.carbs) ?? 0,
          }
        : undefined,
  };
}

/**
 * Продукти, дописані людьми.
 *
 * Читаються всі, а не лише свої: власний продукт може стояти в рецепті, який
 * видно всій спільноті, і без цього чужа страва показувала б сирий ключ
 * замість назви.
 */
export async function fetchCustomIngredients(): Promise<IngredientDef[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("custom_ingredients").select(CUSTOM_INGREDIENT_SELECT);
  if (error) throw error;
  return ((data ?? []) as unknown as CustomIngredientRow[]).map(rowToIngredient);
}

export async function upsertCustomIngredient(def: IngredientDef, userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("custom_ingredients").upsert({
    key: def.key,
    label: def.label,
    emoji: def.emoji,
    cat: def.cat,
    aliases: def.aliases ?? [],
    staple: def.staple ?? false,
    grams_per_piece: def.gramsPerPiece ?? null,
    grams_per_cup: def.gramsPerCup ?? null,
    default_unit: def.defaultUnit ?? "g",
    kcal: def.nutrition?.kcal ?? null,
    protein: def.nutrition?.protein ?? null,
    fat: def.nutrition?.fat ?? null,
    carbs: def.nutrition?.carbs ?? null,
    created_by: userId,
  });
  if (error) throw error;
}

/* ── Спільний довідник штрихкодів ─────────────────────────────────────── */

export interface CachedBarcode {
  barcode: string;
  name: string;
  brand?: string;
  image?: string;
  ingredientKey: string;
  /** Вага або обʼєм упаковки — те, що написано на пачці. */
  amount?: number;
  unit?: Unit;
  /** Харчова цінність на 100 г з етикетки саме цього товару. */
  nutrition?: Nutrition;
}

/**
 * Що спільнота вже знає про цей штрихкод.
 *
 * Open Food Facts майже не покриває український ринок: більшість кодів 482…
 * не мають там жодного запису. Тому те, що один раз вказав руками хтось із
 * користувачів, зберігається тут і працює для всіх наступних.
 */
export async function fetchCachedBarcode(barcode: string): Promise<CachedBarcode | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("barcode_cache")
    .select("barcode,name,brand,image_url,ingredient_key,amount,unit,kcal,protein,fat,carbs")
    .eq("barcode", barcode)
    .not("ingredient_key", "is", null)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as {
    barcode: string;
    name: string;
    brand: string | null;
    image_url: string | null;
    ingredient_key: string;
    amount: number | string | null;
    unit: string | null;
    kcal: number | string | null;
    protein: number | string | null;
    fat: number | string | null;
    carbs: number | string | null;
  };

  const kcal = numberOrUndefined(row.kcal);
  return {
    barcode: row.barcode,
    name: row.name,
    brand: row.brand ?? undefined,
    image: row.image_url ?? undefined,
    ingredientKey: row.ingredient_key,
    amount: numberOrUndefined(row.amount),
    unit: (row.unit as Unit) ?? undefined,
    // Калорійність — те, з чого починається харчова цінність: без неї решта
    // чисел ні про що не каже, тож і не збираємо їх наполовину.
    nutrition:
      kcal != null
        ? {
            kcal,
            protein: numberOrUndefined(row.protein) ?? 0,
            fat: numberOrUndefined(row.fat) ?? 0,
            carbs: numberOrUndefined(row.carbs) ?? 0,
          }
        : undefined,
  };
}

/**
 * Запамʼятовує, чим виявився товар.
 *
 * Політика таблиці дозволяє лише insert, не update: так один користувач не
 * може переписати чужу відповідь. Через це повторний запис того самого коду
 * очікувано конфліктує — і це не помилка, просто хтось нас випередив.
 */
/* ── Підписки на пуш ──────────────────────────────────────────────────── */

export interface PushSubscriptionRow {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  agent?: string;
}

/**
 * Записує підписку пристрою.
 *
 * Саме upsert за endpoint: браузер може видати той самий endpoint після
 * перевстановлення застосунку, і другий рядок про той самий пристрій означав
 * би два однакові сповіщення.
 */
export async function savePushSubscription(sub: PushSubscriptionRow): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  const { error } = await sb.from("push_subscriptions").upsert(
    {
      endpoint: sub.endpoint,
      user_id: sub.userId,
      p256dh: sub.p256dh,
      auth: sub.auth,
      agent: sub.agent ?? null,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw error;
}

/* ── Коментарі до рецептів ────────────────────────────────────────────── */

interface CommentRow {
  id: string;
  recipe_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

const toComment = (row: CommentRow): RecipeComment => ({
  id: row.id,
  recipeId: row.recipe_id,
  authorId: row.author_id,
  body: row.body,
  createdAt: row.created_at,
});

/**
 * Коментарі під рецептом, найновіші згори.
 *
 * Хто автор — не питаємо тут: профілі вже завантажені в застосунок цілим
 * списком, і другий запит заради імені й аватара був би зайвим.
 */
export async function fetchComments(recipeId: string): Promise<RecipeComment[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from("recipe_comments")
    .select("id,recipe_id,author_id,body,created_at")
    .eq("recipe_id", recipeId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return ((data ?? []) as CommentRow[]).map(toComment);
}

export async function addComment(
  recipeId: string,
  authorId: string,
  body: string,
): Promise<RecipeComment> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase не налаштовано");

  const { data, error } = await sb
    .from("recipe_comments")
    .insert({ recipe_id: recipeId, author_id: authorId, body })
    .select("id,recipe_id,author_id,body,created_at")
    .single();

  if (error) throw error;
  return toComment(data as CommentRow);
}

export async function deleteComment(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("recipe_comments").delete().eq("id", id);
  if (error) throw error;
}

export async function cacheBarcode(item: CachedBarcode, userId?: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  const { error } = await sb.from("barcode_cache").insert({
    barcode: item.barcode,
    name: item.name,
    brand: item.brand ?? null,
    image_url: item.image ?? null,
    ingredient_key: item.ingredientKey,
    amount: item.amount ?? null,
    unit: item.unit ?? null,
    kcal: item.nutrition?.kcal ?? null,
    protein: item.nutrition?.protein ?? null,
    fat: item.nutrition?.fat ?? null,
    carbs: item.nutrition?.carbs ?? null,
    taught_by: userId ?? null,
  });

  // 23505 — код уже в довіднику. Це не помилка: хтось устиг раніше, і його
  // відповідь не гірша за нашу.
  if (error && error.code !== "23505") throw error;
}
