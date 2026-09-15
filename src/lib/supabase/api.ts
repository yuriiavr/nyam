"use client";

import { getSupabase } from "./client";
import type {
  AppNotification,
  CookEvent,
  Course,
  Family,
  FamilyMember,
  IngredientDef,
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
  course: string | null;
  created_at: string;
  /** Ставить тригер recipes_touch — за ним видно, чи дійшла до бази локальна правка. */
  updated_at: string;
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

/**
 * Рядок комори так, як він лежить у базі (після pantry-receipt-name.sql і
 * pantry-products.sql): власний id, власник, картка товару й сирий текст каси.
 */
interface PantryRow {
  id: string;
  user_id: string;
  ingredient_key: string;
  product_id: string | null;
  label: string | null;
  receipt_name: string | null;
  amount: number | string | null;
  unit: string | null;
  qty: string | null;
  barcode: string | null;
  added_at: string;
  expires_at: string | null;
  price_per_gram: number | string | null;
  updated_at: string | null;
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
  id: true,
  user_id: true,
  ingredient_key: true,
  product_id: true,
  label: true,
  receipt_name: true,
  amount: true,
  unit: true,
  qty: true,
  barcode: true,
  added_at: true,
  expires_at: true,
  price_per_gram: true,
  updated_at: true,
} satisfies Record<keyof PantryRow, true>;

export const PANTRY_SELECT = Object.keys(PANTRY_COLUMNS).join(",");

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Справжній uuid — те, що колонка id прийме. Тимчасові «legacy:<key>» (рядки,
 * збережені до I4, які ще не бачили знімка бази) сюди не проходять: у базу вони
 * не пишуться ніколи, а один такий у пачці зробив би 22P02 на весь чек.
 */
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_SHAPE.test(value);

/** Рядок бази → рядок комори. Числа з numeric PostgREST віддає рядками. */
export function rowToPantryItem(row: PantryRow): PantryItem {
  return {
    id: row.id,
    key: row.ingredient_key,
    productId: row.product_id ?? undefined,
    ownerId: row.user_id,
    label: row.label ?? undefined,
    receiptName: row.receipt_name ?? undefined,
    amount: numberOrUndefined(row.amount),
    unit: (row.unit as PantryItem["unit"]) ?? undefined,
    qty: row.qty ?? undefined,
    addedAt: row.added_at,
    expiresAt: row.expires_at ?? undefined,
    barcode: row.barcode ?? undefined,
    pricePerGram: numberOrUndefined(row.price_per_gram),
    updatedAt: row.updated_at ?? undefined,
  };
}

/**
 * Рядок комори для upsert.
 *
 * Власник — `ownerId`, а не той, хто зараз править. Старий ключ «людина +
 * тип» робив із правки чужого рядка другу копію під своїм user_id; тепер
 * тригер pantry_items_before_update однаково лишає власника, але й запит
 * мусить казати правду — інакше RLS-перевірка вставки дивилась би не на того.
 *
 * Усі колонки завжди на місці (порожнє — null): upsert пише лише передані, і
 * прибраний строк чи назва без ключа лишились би в базі старими. updated_at не
 * шлемо — його ставить pantry_items_touch.
 */
export function pantryToRow(userId: string, item: PantryItem) {
  return {
    id: item.id,
    user_id: item.ownerId ?? userId,
    ingredient_key: item.key,
    product_id: isUuid(item.productId) ? item.productId : null,
    label: item.label ?? null,
    receipt_name: item.receiptName ?? null,
    amount: item.amount ?? null,
    unit: item.unit ?? null,
    qty: item.qty ?? null,
    barcode: item.barcode ?? null,
    added_at: item.addedAt,
    expires_at: item.expiresAt ?? null,
    price_per_gram: item.pricePerGram ?? null,
  };
}

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

/**
 * Колонки рецепта для select — за тим самим правилом, що й у комори.
 *
 * Тут воно теж коштувало реального бага. Частину страви (course) додали в
 * таблицю, у тип і у форму, а в текстовий перелік колонок — ні; і в запис
 * теж. Людина обирала «гарнір», бачила його до перезапуску, а база про нього
 * так і не дізналась: у всіх рецептів course лишався порожнім. Тепер забута
 * колонка — це помилка збірки, а не тиха втрата правки.
 */
const RECIPE_COLUMNS = {
  id: true,
  author_id: true,
  title: true,
  description: true,
  emoji: true,
  gradient: true,
  image_url: true,
  cuisine: true,
  meal_types: true,
  moods: true,
  tags: true,
  time_min: true,
  difficulty: true,
  servings: true,
  kcal: true,
  cost_level: true,
  ingredients: true,
  steps: true,
  source_id: true,
  course: true,
  created_at: true,
  updated_at: true,
  likes: true,
  saves: true,
  cooks: true,
  rating_sum: true,
  rating_count: true,
} satisfies Record<keyof RecipeRow, true>;

export const RECIPE_SELECT = Object.keys(RECIPE_COLUMNS).join(",");

/**
 * Допустимі частини страви. У базі на course немає check-обмеження — тож
 * сторожем виступає код: у колонку йде лише те, що застосунок уміє прочитати.
 * `satisfies` не дасть додати нову частину в тип і забути її тут.
 */
const COURSES = {
  whole: true,
  main: true,
  side: true,
  soup: true,
  salad: true,
  snack: true,
  sauce: true,
  dessert: true,
  drink: true,
} satisfies Record<Course, true>;

export function isCourse(value: unknown): value is Course {
  // hasOwnProperty, а не `in`: інакше «toString» теж зійшов би за частину страви.
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(COURSES, value);
}

/* ── Перетворення ─────────────────────────────────────────────────────── */

const pair = (value: string[] | null, fallback: [string, string]): [string, string] =>
  value && value.length >= 2 ? [value[0], value[1]] : fallback;

/**
 * Рецепт, прочитаний з бази, разом із часом останнього запису в неї.
 *
 * Окремим типом, а не полем Recipe: час потрібен лише звірці з локальними
 * правками, які ще не долетіли (див. mergeRecipes у sync.ts), а решта
 * застосунку про нього знати не мусить.
 */
export type StampedRecipe = Recipe & { updatedAt?: string };

export function rowToRecipe(row: RecipeRow, myId?: string | null): StampedRecipe {
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
    // Порожнє або незнайоме значення — «не вказано»: частину виведе courseOf.
    course: isCourse(row.course) ? row.course : undefined,
    ingredients: row.ingredients ?? [],
    steps: row.steps ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
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
    /*
     * null, а не пропуск ключа: upsert пише лише передані колонки, і без
     * course у рядку прибрана частина страви лишалась би в базі старою.
     */
    course: isCourse(recipe.course) ? recipe.course : null,
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
      .select(RECIPE_SELECT)
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
    /*
     * Комора сімʼї — просте обʼєднання рядків учасників, без жодного зведення:
     * молоко у двох людей — це дві справжні пачки, а не дубль. (Колись тут
     * лишався один рядок на тип, бо ключем була пара «людина + тип».)
     * Через unknown, бо select зібрано з PANTRY_COLUMNS, а не заданий рядковим
     * літералом — вивести форму рядка supabase-js уже не може.
     */
    pantry: ((pantry.data ?? []) as unknown as PantryRow[]).map(rowToPantryItem),
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

/**
 * Записує рядок рецепта.
 *
 * `withImage: false` — без колонки image_url: upsert пише лише передані
 * колонки, тож фото в базі лишається тим, яке там є. Так пише sync — фото
 * в нього окремим кроком. Інакше пристрій зі старою копією рецепта (скажімо,
 * ноутбук, де фото змінили з телефона) правкою кроку повертав би в базу
 * посилання на вже прибраний файл — і порожня рамка була б у всіх.
 */
export async function upsertRecipe(
  recipe: Recipe,
  authorId: string,
  { withImage = true }: { withImage?: boolean } = {},
) {
  const sb = getSupabase();
  if (!sb) return;
  const row = recipeToRow(recipe, authorId);
  const { image_url: _image, ...withoutImage } = row;
  const { error } = await sb.from("recipes").upsert(withImage ? row : withoutImage);
  if (error) throw error;
}

/**
 * Яке фото зараз записане в рядку рецепта; null — без фото або рядка немає.
 *
 * Читаємо з бази, а не з локальної копії: та могла застаріти (фото змінили
 * на іншому пристрої), і тоді прибиралося б не те — а справжнє старе фото
 * лишалось би в сховищі сиротою.
 */
export async function getRecipeImage(recipeId: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("recipes")
    .select("image_url")
    .eq("id", recipeId)
    .limit(1);
  if (error) throw error;
  return (data?.[0] as { image_url: string | null } | undefined)?.image_url ?? null;
}

/**
 * Дописує в уже збережений рецепт посилання на фото.
 *
 * Окремим записом, бо рядок рецепта йде в базу раніше за фото: сам текст
 * важить кілобайти й відлітає за мить, а знімок вантажиться секундами — і
 * саме в цей час iOS любить приспати застосунок.
 */
export async function setRecipeImage(recipeId: string, url: string | null) {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("recipes").update({ image_url: url }).eq("id", recipeId);
  if (error) throw error;
}

/**
 * Видаляє рецепт і повертає фото, яке було в його рядку, — щоб прибрати файл.
 *
 * Фото беремо з самої відповіді на видалення, а не з локальної копії: та могла
 * застаріти, а окреме читання перед видаленням — зайвий запит і зайва мить,
 * за яку iOS встигає приспати застосунок. Рядка вже не було — null.
 */
export async function deleteRecipe(id: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.from("recipes").delete().eq("id", id).select("image_url");
  if (error) throw error;
  return (data?.[0] as { image_url: string | null } | undefined)?.image_url ?? null;
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

/** Один рядок комори — за його id. */
export async function upsertPantryItem(userId: string, item: PantryItem) {
  await upsertPantryItems(userId, [item]);
}

/**
 * Записує рядки комори за їхнім id — і один, і цілий чек одним запитом.
 *
 * Одним, бо двадцять позицій двадцятьма запитами — це і двадцять кругів до
 * бази, і двадцять подій realtime у кожного в сімʼї. `onConflict: "id"`:
 * рядок упізнається лише за власним id, тож дві пачки одного типу — два рядки.
 * Тимчасові «legacy:» id тихо пропускаємо (sync їх і так не шле).
 */
export async function upsertPantryItems(userId: string, items: readonly PantryItem[]) {
  const sb = getSupabase();
  const rows = items.filter((item) => isUuid(item.id)).map((item) => pantryToRow(userId, item));
  if (!sb || rows.length === 0) return;
  const { error } = await sb.from("pantry_items").upsert(rows, { onConflict: "id" });
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

/**
 * Прибирає рядки комори за id — зокрема ті, які додав хтось інший із сімʼї.
 *
 * Обмеження по user_id тут не для пошуку, а щоб запит не міг зачепити нічого
 * поза сімʼєю. Шматками по 100: довгий `in (…)` не влазить в адресу запиту.
 */
export async function deletePantryItems(
  userId: string,
  ids: readonly string[],
  memberIds: string[] = [userId],
) {
  const sb = getSupabase();
  const valid = [...new Set(ids.filter(isUuid))];
  if (!sb || valid.length === 0) return;
  for (let i = 0; i < valid.length; i += 100) {
    const { error } = await sb
      .from("pantry_items")
      .delete()
      .in("user_id", memberIds.length ? memberIds : [userId])
      .in("id", valid.slice(i, i + 100));
    if (error) throw error;
  }
}

/**
 * «Базове» вимкнули: прибирає з комори сімʼї всі рядки рівно цього типу.
 * Різновиди не чіпає — вимкнена «Олія» не забирає «Олію оливкову».
 */
export async function deletePantryType(
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

const RECIPE_IMAGES_BUCKET = "recipe-images";

/**
 * Шлях нового фото у сховищі: щоразу новий, з часом у назві.
 *
 * Раніше шлях був один на рецепт — `<user>/<recipe>.jpg` — і заміна фото
 * перезаписувала файл під тим самим посиланням. Посилання в рецепті від
 * цього не мінялось, тож телефон (кеш браузера на годину) і CDN Supabase
 * далі віддавали старий знімок. Після перезапуску це виглядало як правка,
 * що не збереглась. Supabase і сам радить для змінних файлів новий шлях:
 * хвіст `?v=` його Smart CDN може й проігнорувати.
 */
export function recipeImageObjectPath(userId: string, recipeId: string, now = Date.now()): string {
  return `${userId}/${recipeId}-${now.toString(36)}.jpg`;
}

/**
 * Шлях обʼєкта в бакеті за публічним посиланням — лише якщо фото лежить у
 * власній теці користувача. Чуже, стороннє чи data:URL — null: такого не
 * видаляємо ніколи (та й політика сховища не дала б).
 */
export function recipeImagePath(url: string | null | undefined, userId: string): string | null {
  if (!url || !/^https?:\/\//.test(url)) return null;
  const marker = `/storage/v1/object/public/${RECIPE_IMAGES_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const path = decodeURIComponent(url.slice(at + marker.length).split(/[?#]/)[0]);
  return path.startsWith(`${userId}/`) && !path.includes("..") ? path : null;
}

/** Завантажує data:URL у бакет recipe-images і повертає публічне посилання. */
export async function uploadRecipeImage(
  userId: string,
  dataUrl: string,
  recipeId: string,
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase не налаштовано");

  const blob = await (await fetch(dataUrl)).blob();
  const path = recipeImageObjectPath(userId, recipeId);

  const { error } = await sb.storage.from(RECIPE_IMAGES_BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    // Файл під цим шляхом більше ніколи не зміниться — хай кешується надовго.
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw error;

  return sb.storage.from(RECIPE_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Прибирає фото, яке рецепт більше не показує.
 *
 * Лише з власної теки і лише якщо на це посилання не спирається жоден інший
 * видимий рецепт — скажімо, копія, що зберегла чужий знімок. Помилку кидаємо:
 * мовчати вирішує той, хто кличе, — для нього це прибирання, а не збереження.
 */
export async function deleteRecipeImageIfUnused(userId: string, url: string): Promise<void> {
  const sb = getSupabase();
  const path = recipeImagePath(url, userId);
  if (!sb || !path) return;

  const { data, error } = await sb.from("recipes").select("id").eq("image_url", url).limit(1);
  if (error) throw error;
  if (data && data.length > 0) return;

  const { error: removeError } = await sb.storage.from(RECIPE_IMAGES_BUCKET).remove([path]);
  if (removeError) throw removeError;
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
): Promise<StampedRecipe[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const ids = authorIds.length ? authorIds : [userId];
  const { data, error } = await sb
    .from("recipes_with_stats")
    .select(RECIPE_SELECT)
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

export interface CustomIngredientRow {
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
  /** Загальніший тип (supabase/ingredient-parents.sql). */
  parent_key: string | null;
  /** Номер правки: росте з кожною зміною рядка, потрібен вікі-правкам (I3). */
  version: number;
  /** I6 (community-merge.sql): цей тип обʼєднали з іншим — ключ став псевдонімом. */
  merged_into: string | null;
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
  parent_key: true,
  version: true,
  merged_into: true,
} satisfies Record<keyof CustomIngredientRow, true>;

/** Експортовано для npm run db:check: колонки мусять існувати в базі. */
export const CUSTOM_INGREDIENT_SELECT = Object.keys(CUSTOM_INGREDIENT_COLUMNS).join(",");

/**
 * Рядок custom_ingredients → опис типу. Спільний для читання каталогу,
 * відповіді save_custom_ingredient і події realtime: там числа — числами, а
 * колонок, яких у старішій базі ще немає, може й не бути, тож усе через `??`.
 */
export function rowToIngredient(
  row: Partial<CustomIngredientRow> & Pick<CustomIngredientRow, "key" | "label">,
): IngredientDef {
  const kcal = numberOrUndefined(row.kcal ?? null);
  return {
    key: row.key,
    label: row.label,
    emoji: row.emoji || "🥫",
    cat: (row.cat ?? "other") as IngredientDef["cat"],
    aliases: row.aliases ?? [],
    staple: row.staple ?? false,
    gramsPerPiece: numberOrUndefined(row.grams_per_piece ?? null),
    gramsPerCup: numberOrUndefined(row.grams_per_cup ?? null),
    defaultUnit: (row.default_unit ?? "g") as Unit,
    nutrition:
      kcal != null
        ? {
            kcal,
            protein: numberOrUndefined(row.protein ?? null) ?? 0,
            fat: numberOrUndefined(row.fat ?? null) ?? 0,
            carbs: numberOrUndefined(row.carbs ?? null) ?? 0,
          }
        : undefined,
    ...(row.parent_key ? { parent: row.parent_key } : {}),
    ...(row.merged_into ? { mergedInto: row.merged_into } : {}),
    ...(row.version != null && Number.isFinite(Number(row.version)) ? { version: Number(row.version) } : {}),
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
  const { data, error } = await sb
    .from("custom_ingredients")
    .select(CUSTOM_INGREDIENT_SELECT)
    // Порядок і стеля явні: без них вибірка залежала б від налаштувань
    // PostgREST, і на різних пристроях каталог міг би розійтись.
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) throw error;
  return ((data ?? []) as unknown as CustomIngredientRow[]).map(rowToIngredient);
}

/**
 * Записує власний продукт.
 *
 * Саме insert, а не upsert: єдиний шлях сюди — створення, а перезапис за
 * ключем означав би, що чийсь продукт мовчки підмінили чужим. Ключі
 * випадкові, тож збіг практично неможливий; а якщо він таки стався, хай
 * краще буде видима помилка, ніж тихо підмінені калорії в чужому рецепті.
 */
export async function upsertCustomIngredient(def: IngredientDef, userId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("custom_ingredients").insert({
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
    parent_key: def.parent ?? null,
    created_by: userId,
  });
  // 23505 — такий ключ уже є. Повторний запис того самого продукту (він
  // буває при злитті після офлайну) не помилка, а підтвердження.
  if (error && error.code !== "23505") throw error;
}

/**
 * Дописує кілька власних типів — батьків раніше за різновиди.
 *
 * Запобіжник у базі (custom_ingredients_guard) не пустить різновид, чийого
 * батька там ще немає: 23503. А створене без мережі якраз і приїжджає пачкою —
 * «Кефір домашній», а за ним «Кефір домашній безлактозний». Паралельні
 * запити лягали б у довільному порядку, тож тут — по одному, від найзагальнішого.
 * Порядок рахуємо за самим списком, а не за реєстром: реєстр міг ще не
 * отримати ці типи. Різновид, що однаково впав на 23503 (батько — чужий тип,
 * який саме записує інший пристрій), пробуємо ще раз наприкінці.
 *
 * Помилка одного типу не зупиняє решту: перша кидається вже після всіх.
 * `insert` — для перевірки в scripts/check-matching.mjs.
 */
export async function upsertCustomIngredientsInOrder(
  defs: IngredientDef[],
  userId: string,
  insert: (def: IngredientDef, userId: string) => Promise<void> = upsertCustomIngredient,
): Promise<void> {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const depth = (def: IngredientDef) => {
    let n = 0;
    const seen = new Set([def.key]);
    for (let cur = def.parent; cur && byKey.has(cur) && !seen.has(cur); cur = byKey.get(cur)?.parent) {
      seen.add(cur);
      n += 1;
    }
    return n;
  };
  const ordered = [...defs].sort((a, b) => depth(a) - depth(b));

  const code = (error: unknown) =>
    typeof error === "object" && error && "code" in error ? String((error as { code: unknown }).code) : "";
  let failure: unknown = null;
  const later: IngredientDef[] = [];

  for (const def of ordered) {
    try {
      await insert(def, userId);
    } catch (error) {
      if (code(error) === "23503") later.push(def);
      else failure ??= error;
    }
  }
  for (const def of later) {
    try {
      await insert(def, userId);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

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
/** Чи знає база про цю підписку. Питає рядок саме цього пристрою. */
export async function hasPushSubscription(endpoint: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("endpoint")
    .eq("endpoint", endpoint)
    .maybeSingle();
  return !error && Boolean(data);
}

export async function savePushSubscription(sub: PushSubscriptionRow): Promise<void> {
  const sb = getSupabase();
  /*
   * Мовчки не виходимо: підписка без запису в базі — це телефон, який
   * показує «увімкнено», тоді як надсилати нема кому. Хай краще увімкнення
   * чесно провалиться.
   */
  if (!sb) throw new Error("база не налаштована");

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

/* ── Будильник готування з сервера ────────────────────────────────────── */

export interface TimerPush {
  /** Придумує сам клієнт — щоб скасувати рядок, не чекаючи відповіді на запис. */
  id: string;
  userId: string;
  fireAt: string;
  title: string;
  body: string;
  url: string;
  /**
   * Адреса пуш-підписки цього пристрою: сервер дзвонить лише на неї, а не на
   * всі пристрої акаунта. Базі вона має бути відома саме від імені того, хто
   * пише, — інакше тригер timer_pushes_guard запис відхилить.
   */
  endpoint: string;
}

/**
 * Скільки чекати базу з будильником.
 *
 * Сторінка готування шле запис і скасування строго по черзі, а fetch у
 * supabase-js сам ніколи не здається: один запит, що завис на кухонному
 * Wi-Fi, тримав би за собою й «паузу», аж поки будильник не продзвонить.
 */
const TIMER_PUSH_TIMEOUT_MS = 8000;

/**
 * Збій запису чи скасування будильника.
 *
 * `rejected` — база відповіла відмовою (4xx): рядка точно немає і не буде.
 * Інакше (мережа, тайм-аут, 5xx) запит міг і дійти, лише відповідь
 * загубилась, — тож записаний будильник доводиться вважати можливо живим.
 */
export class TimerPushError extends Error {
  readonly rejected: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TimerPushError";
    this.rejected = status >= 400 && status < 500;
  }
}

/**
 * Ставить (або переставляє) будильник, який надішле сервер.
 *
 * Upsert за id: той самий будильник можна записати вдруге — скажімо, коли
 * дозвіл на сповіщення дали вже після старту таймера, — і це не стане другим
 * дзвінком. Помилку кидаємо: мовчати вирішує той, хто кличе.
 */
export async function scheduleTimerPush(push: TimerPush): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new TimerPushError("база не налаштована", 400);

  const { error, status } = await sb
    .from("timer_pushes")
    .upsert(
      {
        id: push.id,
        user_id: push.userId,
        fire_at: push.fireAt,
        title: push.title,
        body: push.body,
        url: push.url,
        endpoint: push.endpoint,
      },
      { onConflict: "id" },
    )
    .abortSignal(AbortSignal.timeout(TIMER_PUSH_TIMEOUT_MS));
  if (error) throw new TimerPushError(error.message, status);
}

/**
 * Скасовує будильник. Рядка вже немає (сервер забрав) — не помилка.
 *
 * Без бази кидаємо, а не мовчимо: тихе «готово» прибрало б скасування з
 * черги повторів, хоча рядок у базі лишився.
 */
export async function cancelTimerPush(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new TimerPushError("база не налаштована", 0);
  const { error, status } = await sb
    .from("timer_pushes")
    .delete()
    .eq("id", id)
    .abortSignal(AbortSignal.timeout(TIMER_PUSH_TIMEOUT_MS));
  if (error) throw new TimerPushError(error.message, status);
}

/**
 * Власні будильники цього пристрою, що ще не настали.
 *
 * Так CookingHost шукає «загублені» будильники: ті, про які не памʼятає
 * сховище таймерів, — наприклад, після того як застосунок вивантажили разом
 * зі сховищем. За адресою (url) знаходить рецепт і крок і повертає таймер на
 * екран. Чужих RLS не покаже.
 *
 * Саме цього пристрою (endpoint), а не всього акаунта: знайдений будильник,
 * чий крок на екрані вже зайнятий іншим таймером, скасовують. Без цієї умови
 * ноутбук скасував би будильник телефона, що лежить заблокований біля плити,
 * — а там, крім сервера, дзвонити нікому. Будильник, записаний на чужу чи
 * колишню підписку, сюди й так дзвонити не міг би, тож губити тут нічого.
 *
 * endpoint у select коду не потрібен — він для npm run db:check: той звіряє
 * колонки з select-ів цього файлу зі схемою, і так побачить базу, на якій
 * timer-push.sql не перезапустили після появи колонки.
 */
export async function fetchTimerPushes(
  endpoint: string,
): Promise<Array<{ id: string; fireAt: number; url: string | null }>> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error, status } = await sb
    .from("timer_pushes")
    .select("id,fire_at,url,endpoint")
    .eq("endpoint", endpoint)
    .gt("fire_at", new Date().toISOString())
    .abortSignal(AbortSignal.timeout(TIMER_PUSH_TIMEOUT_MS));
  if (error) throw new TimerPushError(error.message, status);
  return ((data ?? []) as Array<{ id: string; fire_at: string; url: string | null }>).map((row) => ({
    id: row.id,
    fireAt: Date.parse(row.fire_at),
    url: row.url,
  }));
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
