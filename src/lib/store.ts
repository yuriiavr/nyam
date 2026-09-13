"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { SEED_PROFILES, SEED_RECIPES } from "@/data/seed";
import {
  currentRegistryVersion,
  haveTypes,
  setCustomIngredients as registerCustomIngredients,
  type HaveSet,
} from "@/data/ingredients";
import { normalizeEan } from "./ean";
import {
  consumeForRecipe,
  patchPantryRow,
  rebaseLegacyPantry,
  rebaseRestored,
  restorePantryById,
  stackAllIntoPantry,
  stackIntoPantry,
  type Consumed,
  type LegacyRemoval,
  type PantryInput,
} from "./pantry";
import { mergeShoppingItem, shoppingIdentity } from "./shopping";
import { isLegacyId, legacyKey, normalizePersisted } from "./store-migrations";
import * as sync from "./sync";
import { rowToIngredient, type CustomIngredientRow, type StampedRecipe } from "./supabase/api";
import { isSupabaseConfigured } from "./supabase/client";
import type {
  AppNotification,
  CookEvent,
  Family,
  FamilyMember,
  IdentifierKind,
  PantryItem,
  PlanSlot,
  Product,
  Profile,
  IngredientDef,
  Recipe,
  RecipeStats,
  ShoppingItem,
  Target,
  WeekPlan,
} from "./types";
import { dateKey, newId } from "./utils";

const ME_ID = "u_me";

const defaultProfile: Profile = {
  id: ME_ID,
  handle: "me",
  name: "Мій профіль",
  emoji: "🧑‍🍳",
  gradient: ["#ff6b35", "#ffb020"],
  bio: "Тут буде щось про мене та мою кухню.",
  followers: 0,
};

export type SyncStatus = "offline" | "loading" | "ready" | "error";

/**
 * Що людина відповіла на пропозицію сповіщень на цьому пристрої.
 *
 * enabled — увімкнула; later — «не зараз» (або закрила аркуш чи вікно дозволу);
 * never — «більше не пропонувати»; off — сама вимкнула в налаштуваннях. Останні
 * два — остаточні: після них застосунок не питає сам. Заблокований дозвіл сюди не
 * пишеться: його стан і так читається з браузера, а розблокувати можна будь-коли.
 */
export type PushOfferOutcome = "enabled" | "later" | "never" | "off";

export interface PushOfferRecord {
  outcome: PushOfferOutcome;
  /** Коли відповіли — від цього рахуємо паузу перед наступною пропозицією. */
  at: string;
  /** Скільки разів поспіль відклали «на потім». */
  count: number;
}

/** Дані, які завантажуються з бази після входу. */
export interface RemoteUserState {
  profile: Profile | null;
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
  /**
   * Картки, на які посилаються рядки комори. session.ts тягне їх ДО того, як
   * знімок ляже в стан, — інакше рядок на мить показав би назву типу замість
   * «Галичина 2,5%».
   */
  products?: Product[];
  /**
   * true — `products` перечитано для всієї комори (повне завантаження), тож кеш
   * карток можна підрізати до потрібного. false/немає — лише докачані відсутні.
   */
  productsComplete?: boolean;
}

/**
 * Ідентифікатор, яким картку впізнали чи навчили: і ProductIdentifier з
 * картки, і IdentifierHit з resolve_identifiers підходять як є.
 */
export interface KnownIdentifier {
  kind: IdentifierKind;
  raw: string;
  /** Нормалізоване базою значення, якщо є (ProductIdentifier). */
  value?: string;
  target: Target;
}

/** Що сталось із покупкою в addPantry: у який рядок лягла і яким він був до того (F5). */
export interface PantryAddResult {
  rowId: string;
  /** null — рядок новий. Для «Скасувати» / «Не той товар?» у ScanResultSheet. */
  before: PantryItem | null;
}

export interface AppState {
  hydrated: boolean;
  profile: Profile;
  myRecipes: Recipe[];
  saved: string[];
  likes: string[];
  wishlist: string[];
  dismissed: string[];
  ratings: Record<string, number>;
  cooked: CookEvent[];
  pantry: PantryItem[];
  /**
   * Кеш спільних карток товарів: id → картка (I3).
   *
   * Живе в localStorage разом із коморою: без мережі рядок усе одно
   * називається «Галичина 2,5%», а знайомий штрихкод упізнається. На кожному
   * повному знімку підрізається до карток комори плюс 150 найсвіжіших.
   */
  products: Record<string, Product>;
  /** Нормалізований EAN → id картки: офлайн-впізнавання скану (B1, крок 2). */
  eanIndex: Record<string, string>;
  /**
   * Рядки з тимчасовим «legacy:» id, прибрані до першого знімка (D5).
   *
   * Справжнього id такого рядка ще не знаємо, тож і видалити в базі нічого не
   * можемо. Перший знімок прибирає рівно один відповідний рядок (той самий тип
   * і addedAt, інакше найраніший) — і ніколи пачку, додану пізніше.
   */
  pantryLegacyRemoved: LegacyRemoval[];
  /** Список покупок: те, по що йдуть у магазин. */
  shopping: ShoppingItem[];
  /**
   * Продукти, дописані людьми. Спільні на всю спільноту, бо стоять у
   * публічних рецептах; зберігаються локально, щоб працювати офлайн.
   */
  customIngredients: IngredientDef[];
  following: string[];
  plan: WeekPlan;
  theme: "dark" | "light";
  onboarded: boolean;
  /**
   * Скільки днів не пропонувати те, що вже готували. null — пропонувати все.
   *
   * Уподобання, а не фільтр екрана: людина вирішує це раз і назавжди, а не
   * щоразу, коли відкриває рулетку. Тиждень за замовчуванням — бо саме про
   * повтори минулого тижня й питають «знову це?».
   */
  avoidRecentDays: number | null;
  /**
   * Відповідь на пропозицію сповіщень — саме цього пристрою, не акаунта.
   *
   * Дозвіл і підписка належать браузеру: «так» на телефоні нічого не каже про
   * ноутбук. Тому живе в localStorage і не стирається виходом з акаунта — інакше
   * кожен вхід заново питав би про те, на що цей пристрій уже відповів.
   */
  pushOffer: PushOfferRecord | null;
  /**
   * Правки власних рецептів, які ще не підтвердила база: id → час правки.
   *
   * Живе в localStorage разом із самими рецептами — у цьому вся суть. Правка
   * сама по собі вже там, але наступний запуск перечитує рецепти з бази й
   * затирає її, якщо запит не дійшов: iOS приспала застосунок одразу після
   * «Рецепт оновлено», зникла мережа, сесія ще не піднялась. За позначкою
   * злиття впізнає таку правку, лишає її і дописує в базу ще раз.
   */
  unsyncedRecipes: Record<string, string>;
  /**
   * Змінене фото рецепта, яке ще не записане в базу: id → час правки.
   *
   * Окремо від unsyncedRecipes, бо фото їде окремим кроком і довше: рядок
   * може долетіти, а знімок — ні (застосунок приспали посеред вивантаження,
   * сховище не відповіло). Без цієї позначки наступне ж перечитування бачило
   * б збережений рядок і мовчки міняло б нове фото на старе.
   */
  unsyncedImages: Record<string, string>;
  /**
   * Видалені рецепти, видалення яких база ще не підтвердила: id → час.
   *
   * Без позначки видалення без мережі (чи до входу) жило лише до наступного
   * завантаження: рядок у базі лишався, і рецепт повертався в галерею.
   */
  pendingRecipeDeletes: Record<string, string>;

  /* ── Бекенд ─────────────────────────────────────────────────────────── */
  /** Авторизований користувач; null — не увійшов. */
  account: { id: string; email: string; photo?: string } | null;
  /**
   * Чи вже відомо, є сесія чи ні. Поки false, воротар показує заставку:
   * без цього прапорця той, у кого сесія є, встигав побачити екран входу.
   * Навмисно не зберігається — на кожен запуск перевіряємо заново.
   */
  authChecked: boolean;
  /** Рецепти спільноти з бази (кеш для офлайну). */
  remoteRecipes: Recipe[];
  remoteProfiles: Profile[];
  /** true — контент береться з бази, а не з демо-набору. */
  remoteReady: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;

  /** Сімʼя користувача; null — не входить у жодну. */
  family: Family | null;
  familyMembers: FamilyMember[];
  notifications: AppNotification[];

  setHydrated: (v: boolean) => void;
  setTheme: (t: "dark" | "light") => void;
  setAvoidRecentDays: (days: number | null) => void;
  setOnboarded: (v: boolean) => void;
  /** Записує відповідь про сповіщення; лічильник «на потім» веде сам. */
  setPushOffer: (outcome: PushOfferOutcome) => void;
  updateProfile: (patch: Partial<Profile>) => void;

  setAccount: (account: { id: string; email: string; photo?: string } | null) => void;
  setAuthChecked: (v: boolean) => void;
  setCommunity: (data: { recipes: Recipe[]; profiles: Profile[] }) => void;
  setSyncStatus: (status: SyncStatus, error?: string | null) => void;
  /** Рецепти з бази можуть нести updated_at — за ним звіряються недоставлені правки. */
  applyRemoteUserState: (data: RemoteUserState, myRecipes: StampedRecipe[]) => void;
  setFamily: (family: Family | null, members: FamilyMember[]) => void;
  setNotifications: (items: AppNotification[]) => void;
  markNotificationsRead: () => void;
  resetToLocal: () => void;

  toggleLike: (id: string) => void;
  toggleSave: (id: string) => void;
  toggleFollow: (id: string) => void;
  toggleWish: (id: string) => void;
  dismiss: (id: string) => void;
  undismiss: (id: string) => void;
  clearDismissed: () => void;
  rate: (id: string, stars: number) => void;
  markCooked: (id: string) => void;
  /** Списує з комори те, що пішло на страву (за id рядків); повертає список списаного. */
  consumePantry: (recipe: Recipe, factor?: number) => Consumed[];
  /** Повертає в комору перелічені рядки (знімок до готування) — скасування списання, за id. */
  restorePantry: (items: PantryItem[]) => void;

  /**
   * Кладе картки в кеш (після пошуку, скану, збереження, знімка) і, якщо
   * передано ідентифікатори, — штрихкоди в eanIndex. Рядки комори, чия картка
   * змінила тип, одразу отримують новий тип (у базі це робить тригер).
   */
  upsertProducts: (list: Product[], identifiers?: KnownIdentifier[]) => void;
  /**
   * Дописаний тип прямо з рядка бази (подія realtime, відповідь
   * save_custom_ingredient) або вже готовий опис — без перечитування спільноти.
   */
  upsertCustomIngredientRow: (row: CustomIngredientRow | IngredientDef) => void;

  /**
   * Дописує позиції в список покупок.
   *
   * Повертає, скільки рядків з'явилось і скільки долилось до наявних — бо
   * кнопки «додати те, чого бракує» мають сказати людині, що саме сталось.
   * Без цього поділу долиті кількості виглядали б як ненатиснута кнопка.
   */
  /** Приймає каталог, дописаний людьми, — з бази або з локального сховища. */
  setCustomIngredients: (list: IngredientDef[]) => void;
  /** Створює власний продукт: одразу в каталог, далі в базу. */
  addCustomIngredient: (def: IngredientDef) => void;

  addShopping: (items: ShoppingItem[]) => { fresh: number; merged: number };
  toggleShopping: (id: string) => void;
  updateShopping: (id: string, patch: Partial<ShoppingItem>) => void;
  removeShopping: (id: string) => void;
  /** Прибирає викреслене: похід закінчився. */
  clearBoughtShopping: () => void;

  /**
   * Покупка в комору (D6): той самий id — заміна на місці; інакше складається
   * з тією самою пачкою цього дня або стає новим рядком. Без id — отримає новий.
   */
  addPantry: (item: PantryInput) => PantryAddResult;
  /**
   * Правка одного рядка за id. Ключ зі значенням undefined стирає поле;
   * productId одразу ставить тип картки; рядок із «legacy:» id позначається
   * legacyDirty і в базу не йде до першого знімка.
   */
  updatePantry: (id: string, patch: Partial<PantryItem>) => void;
  /** Поповнення цілим списком (чек, список покупок); повертає id рядків, куди лягли покупки. */
  importPantry: (items: PantryInput[]) => string[];
  /** Прибирає один рядок за id. */
  removePantry: (id: string) => void;
  /** «Базове» вимкнули: прибирає всі рядки рівно цього типу (різновиди лишаються). */
  removePantryType: (key: string) => void;
  clearPantry: () => void;

  addRecipe: (r: Recipe) => void;
  updateRecipe: (id: string, patch: Partial<Recipe>) => void;
  deleteRecipe: (id: string) => void;

  setPlanSlot: (day: string, slot: PlanSlot, recipeId: string | null) => void;
  clearPlan: () => void;
}

const toggleIn = (arr: string[], id: string) =>
  arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

/**
 * Зводить комору з бази з локальною.
 *
 * База — джерело правди для всього, крім рядків, чий запис ще стоїть у черзі
 * (за id): їх лишаємо як є. Інакше знімок, замовлений іншою подією, приносив
 * старе значення й затирав те, що користувач саме зараз набирає.
 *
 * Спершу — перепривʼязка тимчасових id (D5): рядки, збережені ще старим кодом,
 * мають «legacy:<key>», і лише знімок знає їхні справжні id. Змінене офлайн
 * лягає на відповідний серверний рядок, прибране — прибирає рівно один.
 * `upserts` і `removeIds` — що після цього дописати й видалити в базі.
 */
export function mergePantry(
  local: PantryItem[],
  remote: PantryItem[],
  removed: readonly LegacyRemoval[] = [],
  pending: (id: string) => boolean = sync.hasPendingPantryWrite,
): { pantry: PantryItem[]; upserts: PantryItem[]; removeIds: string[]; rebased: boolean } {
  const rebased = removed.length > 0 || local.some((p) => isLegacyId(p.id));
  const base = rebased ? rebaseLegacyPantry(local, remote, removed) : { pantry: remote, upserts: [], removeIds: [] };

  const unsaved = local.filter((p) => !isLegacyId(p.id) && pending(p.id));
  if (unsaved.length === 0) return { ...base, rebased };

  const ids = new Set(unsaved.map((p) => p.id));
  return { ...base, pantry: [...unsaved, ...base.pantry.filter((p) => !ids.has(p.id))], rebased };
}

/**
 * Запис «прибрано, поки id був тимчасовим»: ключ — зі старого id, бо саме під
 * ним рядок лежить у базі, навіть якщо людина встигла змінити тип (D5).
 */
function legacyRemoval(row: Pick<PantryItem, "id" | "key" | "addedAt">): LegacyRemoval {
  return { key: legacyKey(row.id) ?? row.key, addedAt: row.addedAt };
}

/** Скільки карток понад ті, що в коморі, тримати в кеші: «Нещодавні товари» і офлайн-скан. */
const RECENT_PRODUCTS = 150;

/**
 * Кеш карток після повного знімка (D4): картки комори (разом із переможцями
 * обʼєднань) плюс 150 останніх доданих; eanIndex — лише на картки, що лишились.
 * Порядок ключів обʼєкта — порядок вставки, тож «останні» — це хвіст.
 */
export function pruneProductCache(
  products: Record<string, Product>,
  eanIndex: Record<string, string>,
  pantry: readonly PantryItem[],
): { products: Record<string, Product>; eanIndex: Record<string, string> } {
  const keep = new Set<string>();
  for (const row of pantry) if (row.productId) keep.add(row.productId);
  const ids = Object.keys(products);
  for (const id of ids.slice(Math.max(0, ids.length - RECENT_PRODUCTS))) keep.add(id);
  for (const id of [...keep]) {
    const winner = products[id]?.mergedInto;
    if (winner) keep.add(winner);
  }
  const nextProducts: Record<string, Product> = {};
  for (const id of ids) if (keep.has(id)) nextProducts[id] = products[id];
  const nextIndex: Record<string, string> = {};
  for (const [ean, id] of Object.entries(eanIndex)) if (nextProducts[id]) nextIndex[ean] = id;
  return { products: nextProducts, eanIndex: nextIndex };
}

/** Кладе картки в кеш: оновлена переїжджає в хвіст — вона тепер «нещодавня». */
function withProducts(cache: Record<string, Product>, list: readonly Product[]): Record<string, Product> {
  if (list.length === 0) return cache;
  const next = { ...cache };
  for (const product of list) {
    delete next[product.id];
    next[product.id] = product;
  }
  return next;
}

/**
 * Штрихкоди рядків комори з карткою — теж знання для офлайн-скану: людина вже
 * сканувала цей код, і картка до нього відома. Лише дійсні EAN.
 */
function withPantryEans(index: Record<string, string>, pantry: readonly PantryItem[]): Record<string, string> {
  let next = index;
  for (const row of pantry) {
    if (!row.productId || !row.barcode) continue;
    const ean = normalizeEan(row.barcode);
    if (!ean || next[ean] === row.productId) continue;
    if (next === index) next = { ...index };
    next[ean] = row.productId;
  }
  return next;
}

/** Рядки, чия картка в кеші має інший тип, отримують тип картки (той самий масив, якщо змін немає). */
function syncPantryTypes(pantry: PantryItem[], products: Record<string, Product>): PantryItem[] {
  let changed = false;
  const next = pantry.map((row) => {
    const typeKey = row.productId ? products[row.productId]?.typeKey : undefined;
    if (!typeKey || typeKey === row.key) return row;
    changed = true;
    return { ...row, key: typeKey };
  });
  return changed ? next : pantry;
}

/**
 * Те саме для списку покупок: рядок, чий запис ще в черзі, лишається
 * локальним. Інакше галочка «куплено» знімалась би сама, щойно прилетить
 * знімок, замовлений до неї.
 */
function mergeShopping(local: ShoppingItem[], remote: ShoppingItem[]): ShoppingItem[] {
  const unsaved = local.filter((x) => sync.hasPendingShoppingWrite(x.id));
  if (unsaved.length === 0) return remote;

  const ids = new Set(unsaved.map((x) => x.id));
  return [...unsaved, ...remote.filter((x) => !ids.has(x.id))];
}

/**
 * Оптимістично підправляє лічильники в локальній копії рецепта.
 *
 * Лічильники приходять із вʼюхи бази, тобто відображають стан на момент
 * читання. Лайк пишеться окремим рядком у таблицю, і поки той рядок не
 * перечитають, число на картці лишається старим: серце зафарбовується, а «0
 * лайків» так і висить. Тому одразу правимо локальну копію, а наступне
 * читання з бази просто замінить її правдою.
 *
 * Лише коли база справді працює: у демо-режимі поправку на себе робить
 * effectiveStats, і друга поправка тут дала б подвійний рахунок.
 */
function bumpStats(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  id: string,
  delta: Partial<RecipeStats>,
) {
  const state = get();
  if (!state.remoteReady) return;

  const patch = (list: Recipe[]) =>
    list.map((r) =>
      r.id === id
        ? {
            ...r,
            stats: {
              likes: Math.max(0, r.stats.likes + (delta.likes ?? 0)),
              saves: Math.max(0, r.stats.saves + (delta.saves ?? 0)),
              cooks: Math.max(0, r.stats.cooks + (delta.cooks ?? 0)),
              ratingSum: Math.max(0, r.stats.ratingSum + (delta.ratingSum ?? 0)),
              ratingCount: Math.max(0, r.stats.ratingCount + (delta.ratingCount ?? 0)),
            },
          }
        : r,
    );

  set({ remoteRecipes: patch(state.remoteRecipes), myRecipes: patch(state.myRecipes) });
}

/**
 * Час правки для позначки unsyncedRecipes — строго новіший за попередню.
 *
 * Дві правки в ту саму мілісекунду отримали б однакову позначку, і відповідь
 * на першу зняла б позначку другої, ще не збереженої.
 */
function editStamp(previous?: string): string {
  const now = Date.now();
  const last = previous ? Date.parse(previous) : NaN;
  return new Date(Number.isFinite(last) && last >= now ? last + 1 : now).toISOString();
}

type MarkField = "unsyncedRecipes" | "unsyncedImages" | "pendingRecipeDeletes";

/** Знімає позначку — лише якщо вона досі та сама, яку бачив запис. */
function settleMark(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  field: MarkField,
  id: string,
  at: string | undefined,
) {
  const marks = get()[field];
  if (!at || marks[id] !== at) return;
  const { [id]: _settled, ...rest } = marks;
  set({ [field]: rest });
}

/**
 * Шле рецепт у базу і веде його позначки unsyncedRecipes і unsyncedImages.
 *
 * Позначку знімає лише відповідь саме на цю правку: якщо поки летів запис,
 * людина встигла поправити рецепт ще раз, новіша позначка лишається до
 * власної відповіді. Остаточна відмова бази (права, обмеження) позначку теж
 * знімає: повторювати її на кожному запуску марно, а помилку людина вже
 * побачила.
 */
function syncRecipe(
  set: (partial: Partial<AppState>) => void,
  get: () => AppState,
  recipe: Recipe,
) {
  const at = get().unsyncedRecipes[recipe.id];
  const photoAt = get().unsyncedImages[recipe.id];
  const settleRow = () => settleMark(set, get, "unsyncedRecipes", recipe.id, at);
  const settlePhoto = () => settleMark(set, get, "unsyncedImages", recipe.id, photoAt);
  // Лише поки в рецепті той самий знімок: інакше це вже відповідь на старе.
  const replaceImage = (from: (string | null | undefined)[], to: string | null) =>
    set({
      myRecipes: get().myRecipes.map((r) =>
        r.id === recipe.id && from.includes(r.image) ? { ...r, image: to } : r,
      ),
    });
  // Посилання вивантаженого фото: локальна копія могла вже перейти на нього.
  let uploadedUrl: string | undefined;

  sync.pushRecipe(recipe, {
    imageChanged: Boolean(photoAt),
    onImageUploaded: (dataUrl, url) => {
      uploadedUrl = url;
      replaceImage([dataUrl], url);
    },
    onSaved: () => {
      settleRow();
      /*
       * Час запису на копії — ознака «рецепт уже був у базі». За нею перенесення
       * після входу відрізняє видалений на іншому пристрої рецепт від ще не
       * перенесеного і не воскрешає його (див. migrateLocalRecipes). Точний час
       * тут не важливий: звірка з правками бере updated_at з бази, не звідси.
       */
      if (!(recipe as StampedRecipe).updatedAt) {
        const stamp = at ?? new Date().toISOString();
        set({
          myRecipes: get().myRecipes.map((r): StampedRecipe =>
            r.id === recipe.id && !(r as StampedRecipe).updatedAt ? { ...r, updatedAt: stamp } : r,
          ),
        });
      }
    },
    onImageSaved: settlePhoto,
    onRejected: () => {
      settleRow();
      settlePhoto();
    },
    onImageRejected: (current) => {
      settlePhoto();
      /*
       * Показуємо те, що справді лишилось у базі, а не фото, якого там уже не
       * буде. Новішу правку фото це не зачепить: у неї інший знімок.
       * Невідомо, що в базі, — лишаємо як є, виправить наступне перечитування.
       */
      if (current !== undefined) replaceImage([recipe.image, uploadedUrl ?? recipe.image], current);
    },
  });
}

/** Шле видалення і веде позначку pendingRecipeDeletes. */
function syncRecipeDelete(set: (partial: Partial<AppState>) => void, get: () => AppState, id: string) {
  const at = get().pendingRecipeDeletes[id];
  const settle = () => settleMark(set, get, "pendingRecipeDeletes", id, at);
  sync.pushRecipeDelete(id, { onDeleted: settle, onRejected: settle });
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
      hydrated: false,
      profile: defaultProfile,
      myRecipes: [],
      saved: [],
      likes: [],
      wishlist: [],
      dismissed: [],
      ratings: {},
      cooked: [],
      shopping: [],
      customIngredients: [],
      pantry: [],
      products: {},
      eanIndex: {},
      pantryLegacyRemoved: [],
      following: [],
      plan: {},
      theme: "dark",
      avoidRecentDays: 7,
      onboarded: false,
      pushOffer: null,
      unsyncedRecipes: {},
      unsyncedImages: {},
      pendingRecipeDeletes: {},

      account: null,
      authChecked: false,
      remoteRecipes: [],
      remoteProfiles: [],
      remoteReady: false,
      syncStatus: "offline",
      syncError: null,
      family: null,
      familyMembers: [],
      notifications: [],

      setHydrated: (v) => set({ hydrated: v }),
      setTheme: (theme) => set({ theme }),
      setAvoidRecentDays: (avoidRecentDays) => set({ avoidRecentDays }),
      setOnboarded: (onboarded) => set({ onboarded }),

      /*
       * Лічильник рахує лише відкладання поспіль. Будь-яка інша відповідь
       * починає лік заново: хто вмикав, а потім вийшов з акаунта, наступного
       * разу відповідає на нове питання, а не на вже вичерпане нагадування.
       *
       * Версію сховища заради цього поля не піднімаємо: без migrate зміна
       * версії стерла б усе збережене, а відсутнє поле злиття й так заповнить
       * початковим null.
       */
      setPushOffer: (outcome) =>
        set({
          pushOffer: {
            outcome,
            at: new Date().toISOString(),
            count: outcome === "later" ? (get().pushOffer?.count ?? 0) + 1 : 0,
          },
        }),

      updateProfile: (patch) => {
        set({ profile: { ...get().profile, ...patch } });
        sync.pushProfile(patch);
      },

      setAccount: (account) => set({ account }),
      setAuthChecked: (authChecked) => set({ authChecked }),

      setCommunity: ({ recipes, profiles }) => {
        // Видалене, яке ще не дійшло до бази, не повертається й у стрічку.
        const deleting = get().pendingRecipeDeletes;
        set({
          remoteRecipes: recipes.filter((r) => !deleting[r.id]),
          remoteProfiles: profiles,
          remoteReady: true,
        });
      },

      setSyncStatus: (syncStatus, syncError = null) => set({ syncStatus, syncError }),

      applyRemoteUserState: (data, myRecipes) => {
        /*
         * Рецепти зводимо, а не підставляємо: правка, що не дійшла до бази
         * або саме летить, інакше зникала б при першому ж перечитуванні —
         * рівно те «міняється на телефоні до перезапуску». Див. mergeRecipes.
         */
        const merged = sync.mergeRecipes(get().myRecipes, myRecipes, {
          rows: get().unsyncedRecipes,
          images: get().unsyncedImages,
          deletes: get().pendingRecipeDeletes,
        });

        const state = get();
        let products = withProducts(state.products, data.products ?? []);
        const pantryMerge = mergePantry(state.pantry, data.pantry, state.pantryLegacyRemoved);
        const pantry = syncPantryTypes(pantryMerge.pantry, products);
        let eanIndex = withPantryEans(state.eanIndex, pantry);
        if (data.productsComplete) ({ products, eanIndex } = pruneProductCache(products, eanIndex, pantry));

        set({
          profile: data.profile ?? get().profile,
          myRecipes: merged.recipes,
          unsyncedRecipes: merged.marks.rows,
          unsyncedImages: merged.marks.images,
          pendingRecipeDeletes: merged.marks.deletes,
          likes: data.likes,
          saved: data.saves,
          wishlist: data.wishlist,
          dismissed: data.dismissed,
          ratings: data.ratings,
          cooked: data.cooked,
          following: data.following,
          pantry,
          products,
          eanIndex,
          // Перепривʼязка відбулась — відкладені видалення вже в removeIds.
          ...(pantryMerge.rebased ? { pantryLegacyRemoved: [] } : {}),
          shopping: mergeShopping(get().shopping, data.shopping),
          plan: data.plan,
        });

        // Правки й видалення, зроблені ще з тимчасовими id, — тепер за справжніми.
        if (pantryMerge.upserts.length) sync.pushPantryBulk(pantryMerge.upserts);
        if (pantryMerge.removeIds.length) sync.pushPantryRemove(pantryMerge.removeIds);

        for (const recipe of merged.resend) syncRecipe(set, get, recipe);
        for (const id of merged.redelete) syncRecipeDelete(set, get, id);
      },

      setFamily: (family, members) => set({ family, familyMembers: members }),

      setNotifications: (notifications) => set({ notifications }),

      markNotificationsRead: () =>
        set({
          notifications: get().notifications.map((n) =>
            n.readAt ? n : { ...n, readAt: new Date().toISOString() },
          ),
        }),

      /**
       * Вихід з акаунта — повертаємось до демо-режиму з чистим станом.
       *
       * Кеш карток і відкладені видалення теж: акаунти не ділять кешів, а
       * «прибране» одним акаунтом після входу іншого видалило б уже чужий рядок.
       */
      resetToLocal: () =>
        set({
          account: null,
          family: null,
          familyMembers: [],
          notifications: [],
          profile: defaultProfile,
          myRecipes: [],
          saved: [],
          likes: [],
          wishlist: [],
          dismissed: [],
          ratings: {},
          cooked: [],
          pantry: [],
          products: {},
          eanIndex: {},
          pantryLegacyRemoved: [],
          shopping: [],
          following: [],
          plan: {},
          unsyncedRecipes: {},
          unsyncedImages: {},
          pendingRecipeDeletes: {},
          syncStatus: "offline",
          syncError: null,
        }),

      toggleLike: (id) => {
        const next = toggleIn(get().likes, id);
        const on = next.includes(id);
        set({ likes: next });
        bumpStats(set, get, id, { likes: on ? 1 : -1 });
        sync.pushLike(id, on);
      },

      toggleSave: (id) => {
        const next = toggleIn(get().saved, id);
        const on = next.includes(id);
        set({ saved: next });
        bumpStats(set, get, id, { saves: on ? 1 : -1 });
        sync.pushSave(id, on);
      },

      toggleFollow: (id) => {
        const next = toggleIn(get().following, id);
        set({ following: next });
        sync.pushFollow(id, next.includes(id));
      },

      toggleWish: (id) => {
        const next = toggleIn(get().wishlist, id);
        const wasDismissed = get().dismissed.includes(id);
        set({ wishlist: next, dismissed: get().dismissed.filter((x) => x !== id) });
        sync.pushWish(id, next.includes(id));
        if (wasDismissed) sync.pushDismiss(id, false);
      },

      dismiss: (id) => {
        if (get().dismissed.includes(id)) return;
        set({ dismissed: [...get().dismissed, id] });
        sync.pushDismiss(id, true);
      },

      undismiss: (id) => {
        set({ dismissed: get().dismissed.filter((x) => x !== id) });
        sync.pushDismiss(id, false);
      },

      clearDismissed: () => {
        set({ dismissed: [] });
        sync.pushDismissClear();
      },

      rate: (id, stars) => {
        // Оцінка не додається, а замінюється: якщо вже ставили, у сумі
        // міняється лише різниця, а кількість оцінок лишається тією самою.
        const previous = get().ratings[id];
        set({ ratings: { ...get().ratings, [id]: stars } });
        bumpStats(set, get, id, {
          ratingSum: stars - (previous ?? 0),
          ratingCount: previous ? 0 : 1,
        });
        sync.pushRating(id, stars);
      },

      /*
       * Списання після приготування.
       *
       * Окремо від markCooked, бо це різні події: «я це готував» іде в
       * історію завжди, а «продукти скінчились» стосується лише тих, чию
       * кількість у коморі вказано. Повертаємо перелік змін, щоб екран
       * завершення міг показати їх і дати скасувати.
       */
      consumePantry: (recipe, factor = 1) => {
        const state = get();
        const { pantry, consumed } = consumeForRecipe(state.pantry, recipe, factor, state.products);
        if (consumed.length === 0) return [];

        const left = new Map(pantry.map((p) => [p.id, p]));
        const touched = [...new Set(consumed.map((c) => c.id))];
        const written = touched.flatMap((id) => left.get(id) ?? []);
        const emptied = state.pantry.filter((p) => touched.includes(p.id) && !left.has(p.id));
        // Спорожнілий рядок із тимчасовим id базі не назвати — його прибере перший знімок.
        const legacyGone = emptied.filter((p) => isLegacyId(p.id)).map(legacyRemoval);

        set({
          pantry,
          ...(legacyGone.length ? { pantryLegacyRemoved: [...state.pantryLegacyRemoved, ...legacyGone] } : {}),
        });
        sync.pushPantryBulk(written);
        sync.pushPantryRemove(emptied.map((p) => p.id));
        return consumed;
      },

      restorePantry: (list) => {
        // Повертаємо саме ті рядки, які змінились, а не всю комору: поки
        // тривало готування, у ній могло зʼявитись щось іще.
        const state = get();
        // Тимчасові рядки, які вже встиг перепривʼязати чи прибрати знімок, — на їхні справжні місця.
        const items = rebaseRestored(state.pantry, list, state.pantryLegacyRemoved);
        const back = items.filter((i) => isLegacyId(i.id)).map(legacyRemoval);
        set({
          pantry: restorePantryById(state.pantry, items),
          // Повернутий тимчасовий рядок більше не «прибраний».
          ...(back.length
            ? {
                pantryLegacyRemoved: state.pantryLegacyRemoved.filter(
                  (r) => !back.some((b) => b.key === r.key && b.addedAt === r.addedAt),
                ),
              }
            : {}),
        });
        sync.pushPantryBulk(items);
      },

      upsertProducts: (list, identifiers = []) => {
        const state = get();
        const products = withProducts(state.products, list);
        let eanIndex = state.eanIndex;
        for (const known of identifiers) {
          if (known.kind !== "ean" || !("productId" in known.target)) continue;
          const ean = normalizeEan(known.value ?? known.raw);
          if (!ean || eanIndex[ean] === known.target.productId) continue;
          if (eanIndex === state.eanIndex) eanIndex = { ...eanIndex };
          eanIndex[ean] = known.target.productId;
        }
        const pantry = syncPantryTypes(state.pantry, products);
        set({ products, eanIndex, ...(pantry !== state.pantry ? { pantry } : {}) });
      },

      upsertCustomIngredientRow: (row) => {
        // Рядок бази впізнаємо за snake_case-колонкою; готовий опис — як є.
        const def =
          "default_unit" in row || "parent_key" in row || "grams_per_piece" in row
            ? rowToIngredient(row as CustomIngredientRow)
            : (row as IngredientDef);
        if (!def.key || !def.label) return;
        const list = get().customIngredients;
        const at = list.findIndex((d) => d.key === def.key);
        // Через setCustomIngredients: той самий вміст не стає новою версією реєстру.
        get().setCustomIngredients(at >= 0 ? list.map((d, i) => (i === at ? def : d)) : [def, ...list]);
      },

      markCooked: (id) => {
        const at = new Date().toISOString();
        const wasWished = get().wishlist.includes(id);
        set({
          cooked: [{ recipeId: id, at }, ...get().cooked].slice(0, 400),
          wishlist: get().wishlist.filter((x) => x !== id),
        });
        bumpStats(set, get, id, { cooks: 1 });
        sync.pushCook(id, at);
        if (wasWished) sync.pushWish(id, false);
      },

      /*
       * Дописує позиції, зливаючи їх із тим, що в списку вже є: 200 г
       * борошна з одного рецепта і 300 г з іншого мають стати «500 г», а не
       * двома однаковими рядками, між якими в магазині доведеться обирати.
       *
       * Викреслене не чіпаємо навмисно. Молоко, яке вже кинули в кошик, —
       * закрите питання; якщо його треба ще, це новий рядок, а не воскресіння
       * старого зі знятою галочкою.
       */
      setCustomIngredients: (list) => {
        /*
         * Спільнота перезавантажується від кожної чужої правки рецепта, і
         * каталог приїжджає новим масивом навіть незмінним. Новий масив — нова
         * версія реєстру: головна перераховує «Для тебе» (там випадковий шум) і
         * картки міняються місцями під пальцем. Тож той самий вміст — не подія.
         * Список — десятки рядків, порівняти текстом дешевше за перерахунок.
         */
        const current = get().customIngredients;
        if (current.length === list.length && JSON.stringify(current) === JSON.stringify(list)) return;
        // Реєстр у модулі каталогу — для коду, який про React не знає:
        // калорії, міри, розбір чека. Стан — щоб екрани перемалювались.
        registerCustomIngredients(list);
        set({ customIngredients: list });
      },

      addCustomIngredient: (def) => {
        const next = [def, ...get().customIngredients.filter((d) => d.key !== def.key)];
        registerCustomIngredients(next);
        set({ customIngredients: next });
        sync.pushCustomIngredient(def);
      },

      addShopping: (items) => {
        if (items.length === 0) return { fresh: 0, merged: 0 };

        const next = [...get().shopping];
        const written: ShoppingItem[] = [];
        let fresh = 0;
        let merged = 0;

        for (const incoming of items) {
          const identity = shoppingIdentity(incoming);
          const at = next.findIndex((x) => !x.done && shoppingIdentity(x) === identity);
          if (at >= 0) {
            next[at] = mergeShoppingItem(next[at], incoming);
            written.push(next[at]);
            merged += 1;
          } else {
            next.unshift(incoming);
            written.push(incoming);
            fresh += 1;
          }
        }

        set({ shopping: next });
        sync.pushShoppingBulk(written);
        return { fresh, merged };
      },

      toggleShopping: (id) => {
        const next = get().shopping.map((x) => (x.id === id ? { ...x, done: !x.done } : x));
        set({ shopping: next });
        const item = next.find((x) => x.id === id);
        if (item) sync.pushShoppingItem(item);
      },

      updateShopping: (id, patch) => {
        const next = get().shopping.map((x) => (x.id === id ? { ...x, ...patch } : x));
        set({ shopping: next });
        const item = next.find((x) => x.id === id);
        if (item) sync.pushShoppingItem(item);
      },

      removeShopping: (id) => {
        set({ shopping: get().shopping.filter((x) => x.id !== id) });
        sync.pushShoppingRemove(id);
      },

      clearBoughtShopping: () => {
        const bought = get().shopping.filter((x) => x.done);
        if (bought.length === 0) return;
        set({ shopping: get().shopping.filter((x) => !x.done) });
        sync.pushShoppingRemoveMany(bought.map((x) => x.id));
      },

      /*
       * Покупка в комору — через ті самі правила стекування, що й чек (D6):
       * рядок із тим самим id — правка на місці, та сама пачка цього дня —
       * складається, решта — новий рядок. Повертає, куди лягла покупка, щоб
       * аркуш після скану міг показати «Тепер разом» і скасувати саме її.
       */
      addPantry: (item) => {
        const state = get();
        const res = stackIntoPantry(state.pantry, item, dateKey(), state.products);
        // Базовий продукт, який уже є, — нічого не змінилось і писати нічого.
        if (res.pantry === state.pantry) return { rowId: res.rowId, before: res.before };
        /*
         * Повернули рядок із тимчасовим id, який щойно прибрали («Скасувати»
         * після «Не той товар?»): він знову є, тож і відкладене видалення знімаємо —
         * інакше перший знімок прибрав би з бази саме його.
         */
        const gone = res.before === null && isLegacyId(res.rowId) ? legacyRemoval({ ...item, id: res.rowId }) : null;
        const revived = gone
          ? state.pantryLegacyRemoved.filter((r) => !(r.key === gone.key && r.addedAt === gone.addedAt))
          : state.pantryLegacyRemoved;
        set({ pantry: res.pantry, ...(revived !== state.pantryLegacyRemoved ? { pantryLegacyRemoved: revived } : {}) });
        const row = res.pantry.find((p) => p.id === res.rowId);
        if (row) sync.pushPantryAdd(row);
        return { rowId: res.rowId, before: res.before };
      },

      updatePantry: (id, patch) => {
        const state = get();
        const at = state.pantry.findIndex((p) => p.id === id);
        if (at < 0) return;
        const row = patchPantryRow(state.pantry[at], patch, state.products);
        set({ pantry: state.pantry.map((p, i) => (i === at ? row : p)) });
        // Тимчасовий id sync не шле сам; правку донесе перший знімок (legacyDirty).
        sync.pushPantryAdd(row);
      },

      /*
       * Поповнення комори цілим списком — те, що приносить чек чи список покупок.
       *
       * У чеку буває дві пачки того самого молока (стануть одним рядком «1,8 л»),
       * а вдома — ще й учорашня з іншим строком (лишиться окремою). В базу йдемо
       * один раз на весь чек, а не двадцять разів поспіль.
       */
      importPantry: (items) => {
        if (items.length === 0) return [];
        const state = get();
        const { pantry, rowIds } = stackAllIntoPantry(state.pantry, items, dateKey(), state.products);
        if (pantry === state.pantry) return rowIds;
        set({ pantry });
        const written = new Set(rowIds);
        sync.pushPantryBulk(pantry.filter((p) => written.has(p.id)));
        return rowIds;
      },

      removePantry: (id) => {
        const state = get();
        const row = state.pantry.find((p) => p.id === id);
        if (!row) return;
        set({
          pantry: state.pantry.filter((p) => p.id !== id),
          ...(isLegacyId(id) ? { pantryLegacyRemoved: [...state.pantryLegacyRemoved, legacyRemoval(row)] } : {}),
        });
        sync.pushPantryRemove(id);
      },

      removePantryType: (key) => {
        const state = get();
        const gone = state.pantry.filter((p) => p.key === key);
        if (gone.length === 0) return;
        set({ pantry: state.pantry.filter((p) => p.key !== key) });
        // У базі — видалення за типом: воно накриває й рядки з тимчасовими id.
        sync.pushPantryRemoveType(key, gone.map((p) => p.id));
      },

      clearPantry: () => {
        set({ pantry: [], pantryLegacyRemoved: [] });
        sync.pushPantryClear();
      },

      addRecipe: (r) => {
        const { unsyncedRecipes: rows, unsyncedImages: images } = get();
        set({
          myRecipes: [r, ...get().myRecipes],
          unsyncedRecipes: { ...rows, [r.id]: editStamp(rows[r.id]) },
          // Рядок нового рецепта їде без фото, тож фото — окремою позначкою.
          unsyncedImages: r.image ? { ...images, [r.id]: editStamp(images[r.id]) } : images,
        });
        syncRecipe(set, get, r);
      },

      /*
       * Тут жила перевірка «якщо в правці фото-посилання — у базу не писати».
       * Вона захищала від зациклення, коли сюди ж приходило посилання щойно
       * вивантаженого фото. Але форма редагування завжди передає фото разом
       * з рештою полів, і в рецепта з уже вивантаженим фото це якраз
       * посилання — тож будь-яка правка такого рецепта в базу не йшла взагалі.
       * Живе посилання тепер ставить сам syncRecipe, повз цю дію.
       */
      updateRecipe: (id, patch) => {
        const state = get();
        const account = state.account;
        /*
         * Власний рецепт може бути лише в кеші стрічки: скажімо, поки після
         * встановлення ще не дочитались власні. Раніше правка такого рецепта
         * мовчки нічого не робила, хоча форма казала «Рецепт оновлено».
         */
        const before =
          state.myRecipes.find((r) => r.id === id) ??
          state.remoteRecipes.find(
            (r) => r.id === id && (r.mine || (account !== null && r.authorId === account.id)),
          );
        if (!before) return;

        const updated: Recipe = { ...before, ...patch };
        const inMine = state.myRecipes.some((r) => r.id === id);
        /*
         * Фото пишемо в базу, лише якщо цю правку воно справді змінило (або
         * попередня зміна фото ще не долетіла — тоді позначка вже стоїть).
         * Форма передає фото завжди, і на пристрої зі старою копією це
         * посилання на файл, який уже прибрали: записане назад, воно лишило б
         * порожню рамку в усіх.
         */
        const imageChanged = "image" in patch && (patch.image ?? null) !== (before.image ?? null);
        set({
          myRecipes: inMine
            ? state.myRecipes.map((r) => (r.id === id ? updated : r))
            : [updated, ...state.myRecipes],
          unsyncedRecipes: {
            ...state.unsyncedRecipes,
            [id]: editStamp(state.unsyncedRecipes[id]),
          },
          unsyncedImages: imageChanged
            ? { ...state.unsyncedImages, [id]: editStamp(state.unsyncedImages[id]) }
            : state.unsyncedImages,
        });

        syncRecipe(set, get, updated);
      },

      /**
       * Видаляє рецепт звідусіль, де на нього є посилання.
       *
       * remoteRecipes чистимо обовʼязково: це кеш стрічки, він переживає
       * перезапуск застосунку через localStorage, тож без цього видалений
       * рецепт лишався б у стрічці й пошуку до наступного успішного
       * завантаження спільноти.
       */
      deleteRecipe: (id) => {
        const state = get();

        const plan: WeekPlan = {};
        for (const [day, slots] of Object.entries(state.plan)) {
          const kept = Object.fromEntries(
            Object.entries(slots ?? {}).filter(([, recipeId]) => recipeId !== id),
          );
          if (Object.keys(kept).length) plan[day] = kept;
        }

        const ratings = { ...state.ratings };
        delete ratings[id];

        const { [id]: _deleted, ...unsyncedRecipes } = state.unsyncedRecipes;
        const { [id]: _deletedImage, ...unsyncedImages } = state.unsyncedImages;

        set({
          unsyncedRecipes,
          unsyncedImages,
          // До підтвердження бази: інакше видалення без мережі чи до входу
          // жило б лише до наступного завантаження.
          pendingRecipeDeletes: {
            ...state.pendingRecipeDeletes,
            [id]: editStamp(state.pendingRecipeDeletes[id]),
          },
          myRecipes: state.myRecipes.filter((r) => r.id !== id),
          remoteRecipes: state.remoteRecipes.filter((r) => r.id !== id),
          saved: state.saved.filter((x) => x !== id),
          wishlist: state.wishlist.filter((x) => x !== id),
          likes: state.likes.filter((x) => x !== id),
          dismissed: state.dismissed.filter((x) => x !== id),
          cooked: state.cooked.filter((c) => c.recipeId !== id),
          ratings,
          plan,
        });
        syncRecipeDelete(set, get, id);
      },

      setPlanSlot: (day, slot, recipeId) => {
        const plan = { ...get().plan };
        const dayPlan = { ...(plan[day] ?? {}) };
        if (recipeId) dayPlan[slot] = recipeId;
        else delete dayPlan[slot];
        if (Object.keys(dayPlan).length) plan[day] = dayPlan;
        else delete plan[day];
        set({ plan });
        sync.pushPlanSlot(day, slot, recipeId);
      },

      clearPlan: () => {
        set({ plan: {} });
        sync.pushPlanClear();
      },
    }),
    {
      name: "nyam-v1",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      /*
       * Версію НЕ піднімаємо ніколи (D5): стара закешована сторінка з іншою
       * версією і без migrate гідратувала б типові значення й записала б їх
       * назад — тема, онбординг, дописані типи й комора зникли б. Усе, чого нова
       * комора вимагає від старих даних (id рядків, форма кешу карток), робить
       * normalizePersisted — merge запускається на кожній гідратації.
       */
      merge: (persisted, current) => ({
        ...current,
        ...(normalizePersisted(persisted, isSupabaseConfigured) as Partial<AppState>),
      }),
      partialize: ({
        hydrated: _hydrated,
        account: _account,
        authChecked: _authChecked,
        syncStatus: _syncStatus,
        syncError: _syncError,
        family: _family,
        familyMembers: _familyMembers,
        notifications: _notifications,
        ...rest
      }) => rest,
      /**
       * Читаємо localStorage не під час створення стора, а вручну після
       * монтування (див. Providers). Тоді перший клієнтський рендер збігається
       * з серверним, контент видно одразу, а особисті дані підтягуються слідом.
       */
      skipHydration: true,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        /*
         * Дописані продукти лежать і в локальному сховищі: без мережі рецепт
         * із власним продуктом має читатись так само, як із вбудованим.
         * Реєстр каталогу наповнюємо ще до першого малювання.
         */
        registerCustomIngredients(state.customIngredients);
        state.setHydrated(true);
      },
    },
  ),
);

/* ── Похідні селектори ────────────────────────────────────────────────── */

/**
 * Усі доступні рецепти. Коли підключена база — спільнота з неї,
 * інакше вбудований демо-набір. Дублікати за id прибираємо: власні рецепти
 * присутні і в myRecipes, і в публічній вибірці.
 */
export function allRecipes(state: AppState): Recipe[] {
  const community = state.remoteReady ? state.remoteRecipes : SEED_RECIPES;
  const seen = new Set<string>();
  const out: Recipe[] = [];
  for (const r of [...state.myRecipes, ...community]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

export function recipeById(state: AppState, id: string): Recipe | undefined {
  return (
    state.myRecipes.find((r) => r.id === id) ??
    (state.remoteReady ? state.remoteRecipes : SEED_RECIPES).find((r) => r.id === id)
  );
}

/**
 * Статистика з урахуванням дій поточного користувача.
 * У режимі бази лічильники вже включають наші дії — база рахує їх сама,
 * тож локальні надбавки застосовуємо лише в демо-режимі.
 */
export function effectiveStats(state: AppState, r: Recipe): RecipeStats {
  if (state.remoteReady) return r.stats;

  const liked = state.likes.includes(r.id) ? 1 : 0;
  const savedN = state.saved.includes(r.id) ? 1 : 0;
  const myCooks = state.cooked.filter((c) => c.recipeId === r.id).length;
  const myRating = state.ratings[r.id];
  return {
    likes: r.stats.likes + liked,
    saves: r.stats.saves + savedN,
    cooks: r.stats.cooks + myCooks,
    ratingSum: r.stats.ratingSum + (myRating ?? 0),
    ratingCount: r.stats.ratingCount + (myRating ? 1 : 0),
  };
}

export function profileById(state: AppState, id: string): Profile {
  if (id === state.profile.id) return state.profile;
  const pool = state.remoteReady ? state.remoteProfiles : SEED_PROFILES;
  return (
    pool.find((p) => p.id === id) ?? {
      id,
      handle: "unknown",
      name: "Невідомий кухар",
      emoji: "👤",
      gradient: ["#6d5e59", "#a1908a"],
      bio: "",
      followers: 0,
    }
  );
}

export function allProfiles(state: AppState): Profile[] {
  return state.remoteReady ? state.remoteProfiles : SEED_PROFILES;
}

/**
 * Ключі комори як є, без родоводу, — для «вже додано» у виборі продукту й
 * чеклиста базових. Для підбору страв не годиться: там потрібен pantryTypes.
 */
export const pantryKeyList = (pantry: PantryItem[]): string[] => pantry.map((p) => p.key);

/*
 * Кеш на сам масив комори й версію каталогу: сховище міняє масив лише тоді,
 * коли комора справді змінилась, тож селектор повертає той самий обʼєкт між
 * рендерами (zustand інакше перемальовував би без кінця), а нова версія
 * каталогу — новий батько в дописаному типі — перераховує набір.
 */
const PANTRY_TYPES = new WeakMap<PantryItem[], { version: number; set: HaveSet }>();

/**
 * Що «є в коморі» для підбору страв: типи рядків разом із загальнішими.
 * Єдине місце, де набір складається з ключів комори напряму — перевірка
 * scripts/check-matching.mjs валить ручні `pantry.map((p) => p.key)` деінде.
 */
export function pantryTypes(state: Pick<AppState, "pantry">): HaveSet {
  const version = currentRegistryVersion();
  const cached = PANTRY_TYPES.get(state.pantry);
  if (cached && cached.version === version) return cached.set;
  const set = haveTypes(state.pantry.map((p) => p.key));
  PANTRY_TYPES.set(state.pantry, { version, set });
  return set;
}

/** Скільки днів тому востаннє готували цю страву (Infinity — ніколи). */
export function daysSinceCooked(state: AppState, id: string): number {
  const last = state.cooked.find((c) => c.recipeId === id);
  if (!last) return Infinity;
  return (Date.now() - new Date(last.at).getTime()) / 86_400_000;
}

export function cookedToday(state: AppState): CookEvent[] {
  const today = dateKey();
  return state.cooked.filter((c) => dateKey(new Date(c.at)) === today);
}

/** Серія днів поспіль, коли щось готували. */
export function cookStreak(state: AppState): number {
  const days = new Set(state.cooked.map((c) => dateKey(new Date(c.at))));
  let streak = 0;
  const cursor = new Date();
  // Сьогодні ще може бути порожнім — тоді рахуємо від учора.
  if (!days.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export { ME_ID };
