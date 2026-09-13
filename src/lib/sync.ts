"use client";

import { isLegacyId } from "./store-migrations";
import * as api from "./supabase/api";
import { friendlyError, isSupabaseConfigured } from "./supabase/client";
import type { IngredientDef, PantryItem, PlanSlot, Profile, Recipe, ShoppingItem } from "./types";

/**
 * Тонкий шар між сховищем стану і базою.
 *
 * Правило просте: інтерфейс ніколи не чекає на мережу. Дія одразу змінює
 * локальний стан, а сюди йде «відлуння» — запис у базу. Якщо він падає,
 * повідомляємо через шину помилок, але UI не блокуємо.
 *
 * Модуль навмисно НЕ імпортує store, щоб не було циклічної залежності:
 * store → sync → api. Завантаженням даних у store займається session.ts.
 */

let userId: string | null = null;

/**
 * Учасники сімʼї, включно з самим користувачем. Порожній масив — сімʼї немає,
 * і тоді все працює рівно як до неї: у межах одного user_id.
 */
let familyMemberIds: string[] = [];

export function setSyncUser(id: string | null) {
  userId = id;
}

export function setSyncFamily(ids: string[]) {
  familyMemberIds = ids;
}

export function getSyncUser(): string | null {
  return userId;
}

/** Кого зачіпає спільна дія: сімʼю або лише самого користувача. */
function scope(uid: string): string[] {
  return familyMemberIds.length ? familyMemberIds : [uid];
}

/** Чи є куди писати: бекенд налаштовано і користувач авторизований. */
export function canSync(): boolean {
  return isSupabaseConfigured && userId !== null;
}

/* ── Шина помилок ─────────────────────────────────────────────────────── */

type ErrorListener = (message: string) => void;
const listeners = new Set<ErrorListener>();

export function onSyncError(fn: ErrorListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function report(error: unknown, context: string) {
  const message = friendlyError(error);
  console.warn(`[sync] ${context}: ${message}`, error);
  listeners.forEach((fn) => fn(message));
}

/** Запускає запис у базу, не змушуючи інтерфейс чекати. */
function fire(context: string, run: (uid: string) => Promise<unknown>) {
  if (!canSync()) return;
  const uid = userId as string;
  run(uid).catch((error) => report(error, context));
}

/* ── Соціальні дії ────────────────────────────────────────────────────── */

export const pushLike = (recipeId: string, on: boolean) =>
  fire("лайк", (uid) => api.setRelation("likes", uid, recipeId, on));

export const pushSave = (recipeId: string, on: boolean) =>
  fire("збереження", (uid) => api.setRelation("saves", uid, recipeId, on, scope(uid)));

export const pushWish = (recipeId: string, on: boolean) =>
  fire("список бажань", (uid) => api.setRelation("wishlist", uid, recipeId, on, scope(uid)));

export const pushDismiss = (recipeId: string, on: boolean) =>
  fire("приховування", (uid) => api.setRelation("dismissed", uid, recipeId, on));

export const pushRating = (recipeId: string, stars: number) =>
  fire("оцінка", (uid) => api.setRating(uid, recipeId, stars));

export const pushCook = (recipeId: string, at: string) =>
  fire("історія готування", (uid) => api.addCook(uid, recipeId, at));

export const pushFollow = (profileId: string, on: boolean) =>
  fire("підписка", (uid) => api.setFollow(uid, profileId, on));

/**
 * Те саме, але з відкладенням: усі виклики з однаковим `key` за час затримки
 * зливаються в один запис останнього стану.
 *
 * Потрібно там, де значення міняється посимвольно — наприклад, кількість
 * продукту в коморі. Без цього «200» летіло б у базу трьома запитами, і
 * відповіді могли прийти не в тому порядку, лишивши в рядку «2».
 */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

function fireDebounced(
  context: string,
  key: string,
  delayMs: number,
  run: (uid: string) => Promise<unknown>,
  send: (context: string, run: (uid: string) => Promise<unknown>) => void = fire,
) {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);
  pending.set(
    key,
    setTimeout(() => {
      send(context, run);
      /*
       * Позначку тримаємо ще трохи після відправлення. Сам запит теж триває:
       * якщо зняти її одразу, знімок, замовлений до нього, повернеться вже
       * без нашого значення й затре щойно введене — рівно та біда, заради
       * якої ці позначки й існують.
       */
      pending.set(
        key,
        setTimeout(() => pending.delete(key), BULK_GUARD_MS),
      );
    }, delayMs),
  );
}

/**
 * Чи є для цього рядка комори (за id) запис, який ще не полетів у базу.
 *
 * Потрібно тому, що відповідь бази може прийти раніше за наш власний
 * відкладений запис: користувач вводить «200», realtime приносить знімок
 * комори, де цього числа ще немає, і воно зникає з поля просто під час
 * набору. Такі рядки лишаємо в локальному стані до запису.
 */
export function hasPendingPantryWrite(id: string): boolean {
  return pending.has(`pantry:${id}`);
}

/** Те саме для рядка списку покупок — див. hasPendingPantryWrite. */
export function hasPendingShoppingWrite(id: string): boolean {
  return pending.has(`shopping:${id}`);
}

/* ── Комора ───────────────────────────────────────────────────────────── */

/**
 * Черга, що виконує задачі строго по одній, у порядку постановки.
 *
 * Помилка задачі не рве черги: її отримує `onError`, а наступна задача
 * стартує як завжди. Окремою функцією — щоб порядок можна було перевірити без
 * мережі (scripts/check-pantry.mjs).
 */
export function serialQueue(onError: (error: unknown) => void) {
  let tail: Promise<unknown> = Promise.resolve();
  return (task: () => Promise<unknown>): Promise<unknown> => {
    tail = tail.then(task).catch(onError);
    return tail;
  };
}

/**
 * Записи комори йдуть у базу по черзі (D3).
 *
 * Ключ рядка тепер власний (id), як у списку покупок, і на один рядок за
 * секунду може піти кілька запитів: додали пачку, одразу поправили кількість,
 * потім прибрали. Відправлені врізнобіч, вони приходили б не в тому порядку —
 * і повільний upsert, що долетів після власного видалення, воскрешав би рядок.
 * Черга нічого не блокує в інтерфейсі: він і так не чекає на мережу.
 */
const pantryQueue = serialQueue((error) => report(error, "комора"));

function firePantry(_context: string, run: (uid: string) => Promise<unknown>) {
  if (!canSync()) return;
  const uid = userId as string;
  void pantryQueue(() => run(uid));
}

/**
 * Рядки, які можна слати в базу: із тимчасовим «legacy:» id — ніколи.
 *
 * Запобіжник назавжди, не лише на перехідний час: пристрій, що пролежав офлайн
 * довше за будь-яке вікно міграції, інакше слав би такі id і отримував 22P02
 * на кожен запис. Правки таких рядків донесе перепривʼязка на першому знімку
 * (rebaseLegacyPantry у сторі), а видалення — pantryLegacyRemoved.
 */
export function sendablePantry<T extends { id: string }>(items: readonly T[]): T[] {
  return items.filter((item) => !isLegacyId(item.id));
}

/** Один рядок: кількість, строк, картка. З відкладенням — число набирають посимвольно. */
export const pushPantryAdd = (item: PantryItem) => {
  if (isLegacyId(item.id)) return;
  fireDebounced("комора", `pantry:${item.id}`, 500, (uid) => api.upsertPantryItems(uid, [item]), firePantry);
};

/**
 * Скільки рядок із чека вважається «щойно записаним».
 *
 * Свідомо більше за 800 мс, з якими realtime відкладає перезавантаження
 * стану: інакше знімок, замовлений чужою подією, встигав прийти без наших
 * позицій і зітерти щойно внесений чек.
 */
const BULK_GUARD_MS = 3000;

/**
 * Скільки пачка чекає перед відправленням.
 *
 * Без цієї паузи фільтр нижче не робить нічого: запис ставиться тієї ж миті,
 * тож перевіряє позначки, які сам щойно й поставив. А рядок, прибраний одразу
 * після додавання, встигав полетіти в базу вже після власного видалення — і
 * повертався до списку наступним знімком.
 */
const BULK_SEND_MS = 250;

/**
 * Запис цілого чека одним запитом.
 *
 * Позначку «запис у польоті» ставимо на кожен рядок до відправлення, а не
 * після: саме за нею mergePantry впізнає те, чого в базі ще немає, і не дає
 * відповіді бази затерти свіжий імпорт.
 */
export const pushPantryBulk = (items: readonly PantryItem[]) => {
  const sendable = sendablePantry(items);
  if (sendable.length === 0) return;

  for (const item of sendable) {
    const key = `pantry:${item.id}`;
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);
    // Таймер-вартовий нічого не пише — він лише тримає ознаку запису.
    pending.set(key, setTimeout(() => pending.delete(key), BULK_GUARD_MS));
  }

  setTimeout(() => {
    // Рядок, який устигли прибрати з комори, поки чек летів, у пакет не
    // потрапляє: pushPantryRemove знімає його позначку, і це наш сигнал.
    const payload = sendable.filter((item) => pending.has(`pantry:${item.id}`));
    if (payload.length === 0) return;
    firePantry("комора", (uid) => api.upsertPantryItems(uid, payload));
  }, BULK_SEND_MS);
};

/** Знімає відкладений запис рядка: інакше він відтворив би щойно видалений рядок. */
function cancelPantryWrite(id: string) {
  const timer = pending.get(`pantry:${id}`);
  if (timer) {
    clearTimeout(timer);
    pending.delete(`pantry:${id}`);
  }
}

/**
 * Прибирає рядки за id. Тимчасових «legacy:» не шле: їх записує стор у
 * pantryLegacyRemoved, і перший знімок прибере рівно відповідний рядок.
 */
export const pushPantryRemove = (ids: string | readonly string[]) => {
  const list = (typeof ids === "string" ? [ids] : [...ids]).filter((id) => !isLegacyId(id));
  for (const id of list) cancelPantryWrite(id);
  if (list.length === 0) return;
  firePantry("комора", (uid) => api.deletePantryItems(uid, list, scope(uid)));
};

/**
 * «Базове» вимкнули: у базі йдуть усі рядки рівно цього типу в сімʼї.
 * `ids` — локальні рядки цього типу, чиї відкладені записи треба зняти.
 */
export const pushPantryRemoveType = (key: string, ids: readonly string[] = []) => {
  for (const id of ids) cancelPantryWrite(id);
  firePantry("комора", (uid) => api.deletePantryType(uid, key, scope(uid)));
};

export const pushPantryClear = () => {
  for (const [key, timer] of pending) {
    if (key.startsWith("pantry:")) {
      clearTimeout(timer);
      pending.delete(key);
    }
  }
  firePantry("комора", (uid) => api.clearPantry(uid, scope(uid)));
};

/*
 * Навчання спільної бази (teach_identifiers) сюди не входить: і скан, і чек,
 * і «Обрати товар» чекають відповіді — там бувають уточнення й конфлікти, які
 * розбирає src/components/pantry/catalog.ts (teachAndSettle).
 */

/* ── Список покупок ───────────────────────────────────────────────────── */

/**
 * Записи списку йдуть у базу по черзі.
 *
 * Лайки, оцінки й план обходяться без цього: там ключ рядка — пара «людина +
 * рецепт», і два записи про різне не стикаються. Тут ключ власний, і по
 * одному рядку за секунду може піти кілька запитів: додали позицію, одразу
 * поставили галочку, потім прибрали. Відправлені врізнобіч, вони можуть
 * прийти не в тому порядку — і в базі лишиться стан із середини, а галочка
 * «куплено» сама зніметься за хвилину, коли прилетить наступний знімок.
 *
 * Черга нічого не блокує в інтерфейсі: він і так не чекає на мережу.
 */
let shoppingQueue: Promise<unknown> = Promise.resolve();

function fireShopping(run: (uid: string) => Promise<unknown>) {
  if (!canSync()) return;
  const uid = userId as string;
  shoppingQueue = shoppingQueue
    .then(() => run(uid))
    .catch((error) => report(error, "список покупок"));
}

/**
 * Один рядок: галочка «куплено», зміна кількості, перейменування.
 *
 * З відкладенням, як і кількість у коморі: люди набирають число посимвольно,
 * і без цього «200» летіло б у базу трьома запитами, відповіді на які можуть
 * прийти не в тому порядку.
 */
export const pushShoppingItem = (item: ShoppingItem) => {
  const key = `shopping:${item.id}`;
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);

  pending.set(
    key,
    setTimeout(() => {
      fireShopping((uid) => api.upsertShoppingItems(uid, [item]));
      // Позначку тримаємо ще трохи після відправлення — як у fireDebounced.
      pending.set(key, setTimeout(() => pending.delete(key), BULK_GUARD_MS));
    }, 400),
  );
};

/** Ціла пачка одразу — те, що приносить кнопка «додати, чого бракує». */
export const pushShoppingBulk = (items: ShoppingItem[]) => {
  if (items.length === 0) return;

  for (const item of items) {
    const key = `shopping:${item.id}`;
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);
    // Вартовий нічого не пише — лише тримає ознаку запису, поки лист летить.
    pending.set(key, setTimeout(() => pending.delete(key), BULK_GUARD_MS));
  }

  setTimeout(() => {
    // Рядок, який устигли прибрати зі списку, поки пачка чекала, у неї не
    // потрапляє: pushShoppingRemove знімає позначку, і це наш сигнал.
    const payload = items.filter((item) => pending.has(`shopping:${item.id}`));
    if (payload.length === 0) return;
    fireShopping((uid) => api.upsertShoppingItems(uid, payload));
  }, BULK_SEND_MS);
};

export const pushShoppingRemove = (id: string) => {
  const timer = pending.get(`shopping:${id}`);
  if (timer) {
    clearTimeout(timer);
    pending.delete(`shopping:${id}`);
  }
  fireShopping((uid) => api.deleteShoppingItems(uid, [id], scope(uid)));
};

export const pushShoppingRemoveMany = (ids: string[]) => {
  if (ids.length === 0) return;
  for (const id of ids) {
    const timer = pending.get(`shopping:${id}`);
    if (timer) {
      clearTimeout(timer);
      pending.delete(`shopping:${id}`);
    }
  }
  fireShopping((uid) => api.deleteShoppingItems(uid, ids, scope(uid)));
};

export const pushPlanSlot = (day: string, slot: PlanSlot, recipeId: string | null) =>
  fire("план", (uid) => api.setPlanSlot(uid, day, slot, recipeId, scope(uid)));

export const pushProfile = (patch: Partial<Profile>) =>
  fire("профіль", (uid) => api.updateProfile(uid, patch));

/*
 * Власні типи — теж по черзі. Різновид посилається на батька, і база не
 * запише «Кефір домашній безлактозний», поки не побачить «Кефір домашній»:
 * створені один за одним і відправлені врізнобіч, вони лягали б у довільному
 * порядку, і різновид падав би на 23503.
 */
let customQueue: Promise<unknown> = Promise.resolve();

function fireCustom(run: (uid: string) => Promise<unknown>) {
  if (!canSync()) return;
  const uid = userId as string;
  customQueue = customQueue.then(() => run(uid)).catch((error) => report(error, "власний продукт"));
}

/** Власний продукт: у спільний каталог, щоб його бачили і в чужих рецептах. */
export const pushCustomIngredient = (def: IngredientDef) =>
  fireCustom((uid) => api.upsertCustomIngredient(def, uid));

/** Пачка власних типів, що не дійшли до бази, — батьки раніше за різновиди. */
export const pushCustomIngredientsInOrder = (defs: IngredientDef[]) => {
  if (defs.length === 0) return;
  fireCustom((uid) => api.upsertCustomIngredientsInOrder(defs, uid));
};

/* ── Рецепти ──────────────────────────────────────────────────────────── */

/**
 * Записи одного рецепта йдуть у базу строго по черзі.
 *
 * Збереження рецепта — це кілька запитів: рядок, фото, посилання на фото,
 * прибирання старого знімка. Дві правки поспіль, відправлені врізнобіч, могли
 * б прийти навпаки — і в базі лишилась би перша. А видалення, що обігнало
 * власне створення, воскрешало б щойно видалений рецепт.
 */
const recipeQueues = new Map<string, Promise<void>>();

/**
 * Рецепти, чий запис зараз летить або щойно долетів.
 *
 * Лічильник, а не множина: у черзі одного рецепта буває кілька правок. Після
 * останньої позначка тримається ще BULK_GUARD_MS — з тієї ж причини, що й у
 * комори: знімок, замовлений до запису, повертається вже після нього.
 */
const recipesInFlight = new Map<string, number>();

export function isRecipeInFlight(id: string): boolean {
  return (recipesInFlight.get(id) ?? 0) > 0;
}

function holdRecipe(id: string) {
  recipesInFlight.set(id, (recipesInFlight.get(id) ?? 0) + 1);
}

function releaseRecipe(id: string) {
  setTimeout(() => {
    const left = (recipesInFlight.get(id) ?? 1) - 1;
    if (left > 0) recipesInFlight.set(id, left);
    else recipesInFlight.delete(id);
  }, BULK_GUARD_MS);
}

/**
 * Фото, яке цей сеанс уже вивантажив: data:URL → посилання.
 *
 * Друга правка, зроблена, поки перша ще вантажила знімок, несе в собі той
 * самий data:URL. Без цього запису вона вантажила б фото вдруге — і лишала
 * б у сховищі сироту.
 */
const uploadedImages = new Map<string, { dataUrl: string; url: string }>();

/**
 * Про яке фото вже сказали, що воно не завантажилось: рецепт → data:URL.
 *
 * Недовантажене фото тепер дошле кожне перечитування бази — а воно буває
 * щохвилини. Без цього запису людина без стабільної мережі отримувала б той
 * самий тост знову й знову.
 */
const imageFailureNoted = new Map<string, string | null>();

/** Коди сховища, з якими повтор марний: заборонено, завеликий файл, не той тип. */
const PERMANENT_STORAGE = new Set(["AccessDenied", "EntityTooLarge", "InvalidMimeType", "NoSuchBucket"]);

/**
 * Чи відмовила база остаточно, а не просто не відповіла.
 *
 * Класи SQLSTATE 22 (неприпустимі дані), 23 (порушене обмеження) і 42 (права,
 * RLS, невідома колонка): повтор дасть те саме. Сховище відповідає HTTP-кодом:
 * 403 (політика), 413 (завеликий), 415 (не той тип) — теж остаточно. Мережа,
 * тайм-аут, прострочений токен (PGRST…, InvalidJWT) — тимчасове: такий запис
 * варто повторити.
 */
export function isPermanentRejection(error: unknown): boolean {
  if (typeof error !== "object" || !error) return false;
  const { code, status, statusCode } = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  if (typeof code === "string" && /^(22|23|42)[0-9A-Z]{3}$/.test(code)) return true;
  if (code === "InvalidJWT") return false;
  if (typeof code === "string" && PERMANENT_STORAGE.has(code)) return true;
  // Старі версії сховища кладуть справжній код у тіло (statusCode), а HTTP віддають 400.
  return [status, statusCode].some((s) => ["403", "413", "415"].includes(String(s)));
}

export interface RecipePushOptions {
  /**
   * Фото змінене правкою, яку база ще не підтвердила, — його треба записати.
   * Інакше колонку фото не чіпаємо зовсім: локальна копія могла застаріти.
   */
  imageChanged?: boolean;
  /** Фото вивантажено: локальна копія може замінити data:URL посиланням. */
  onImageUploaded?: (dataUrl: string, url: string) => void;
  /** Рядок рецепта в базі — текст правки збережено. */
  onSaved?: () => void;
  /** Фото в рядку тепер те, яке хотіла правка. */
  onImageSaved?: () => void;
  /** База відмовила остаточно — повторювати цю правку марно. */
  onRejected?: () => void;
  /** Фото відхилено остаточно; `current` — що лишилось у базі (undefined — невідомо). */
  onImageRejected?: (current: string | null | undefined) => void;
}

/** Те, чим sendRecipe ходить у базу. Окремо — щоб порядок кроків можна було перевірити без мережі. */
export interface RecipeBackend {
  upsertRecipe: typeof api.upsertRecipe;
  uploadRecipeImage: typeof api.uploadRecipeImage;
  getRecipeImage: typeof api.getRecipeImage;
  setRecipeImage: typeof api.setRecipeImage;
  deleteRecipe: typeof api.deleteRecipe;
  deleteRecipeImageIfUnused: typeof api.deleteRecipeImageIfUnused;
}

/** Посилання, яке вже лежить у сховищі, для цього значення фото; null — такого немає. */
function storedImage(recipeId: string, image: string | null | undefined): string | null {
  if (!image) return null;
  if (!image.startsWith("data:")) return image;
  const done = uploadedImages.get(recipeId);
  return done && done.dataUrl === image ? done.url : null;
}

/**
 * Один запис рецепта від початку до кінця.
 *
 * Спершу рядок — без колонки фото, — і лише потім знімок. Раніше було
 * навпаки: рядок чекав, поки довантажиться фото, а iOS за ці секунди
 * встигала приспати застосунок одразу після «Рецепт оновлено». Запит так і не
 * йшов, а наступний запуск перечитував базу — і правка зникала.
 *
 * Фото — окремий крок зі своєю позначкою (unsyncedImages у сховищі стану):
 * рядок може долетіти, а фото ні, і тоді повторити треба саме фото. Поки нове
 * не в сховищі, у рядку лишається те, що там уже є, — хай навіть ця копія
 * рецепта про нього не знає.
 */
export async function sendRecipe(
  uid: string,
  recipe: Recipe,
  options: RecipePushOptions = {},
  backend: RecipeBackend = api,
): Promise<void> {
  await backend.upsertRecipe(recipe, uid, { withImage: false });
  options.onSaved?.();
  if (!options.imageChanged) return;

  const local = recipe.image ?? null;
  let target = storedImage(recipe.id, local);
  // Що зараз у рядку: для тексту помилки і щоб прибрати після заміни. Не прочиталось — лише без прибирання.
  let current: string | null | undefined;
  try {
    current = await backend.getRecipeImage(recipe.id).catch(() => undefined);
    if (local !== null && local.startsWith("data:")) {
      if (target === null) {
        target = await backend.uploadRecipeImage(uid, local, recipe.id);
        uploadedImages.set(recipe.id, { dataUrl: local, url: target });
      }
      // Одразу, ще до запису посилання: важкий base64 не мусить чекати в localStorage.
      options.onImageUploaded?.(local, target);
    }
    if (current !== target) await backend.setRecipeImage(recipe.id, target);
  } catch (error) {
    const permanent = isPermanentRejection(error);
    if (permanent) options.onImageRejected?.(current);
    /*
     * Фото не критичне — текст рецепта вже збережено. Але мовчати про це не
     * можна: інакше знімок просто зникає, і виглядає це як втрата даних без
     * пояснення. Тимчасовий збій фото дошле наступне перечитування бази.
     */
    console.warn("[sync] фото рецепта не завантажилось", error);
    if (imageFailureNoted.get(recipe.id) !== local) {
      imageFailureNoted.set(recipe.id, local);
      const note = !permanent
        ? "Фото поки не завантажилось — рецепт збережено, фото дошлемо згодом"
        : current === undefined
          ? "Нове фото не завантажилось — текст рецепта збережено"
          : current
            ? "Нове фото не завантажилось — рецепт збережено зі старим"
            : "Фото не завантажилось — рецепт збережено без нього";
      listeners.forEach((fn) => fn(note));
    }
    return;
  }

  imageFailureNoted.delete(recipe.id);
  options.onImageSaved?.();

  if (current && current !== target) {
    // Прибирання, а не збереження: збій тут людині нічим не загрожує.
    await backend
      .deleteRecipeImageIfUnused(uid, current)
      .catch((error) => console.warn("[sync] старе фото рецепта не прибралось", error));
  }
}

/** Ставить задачу в чергу рецепта; помилку повідомляє, а черги не рве. */
function enqueueRecipe(id: string, context: string, run: () => Promise<void>, onError?: (error: unknown) => void) {
  holdRecipe(id);
  const next = (recipeQueues.get(id) ?? Promise.resolve())
    .then(run)
    .catch((error) => {
      report(error, context);
      onError?.(error);
    })
    .finally(() => {
      releaseRecipe(id);
      if (recipeQueues.get(id) === next) recipeQueues.delete(id);
    });
  recipeQueues.set(id, next);
}

export interface RecipeDeleteOptions {
  /** Рядка в базі більше немає — видалення можна вважати доставленим. */
  onDeleted?: () => void;
  /** База відмовила остаточно (скажімо, рецепт не свій) — повтор марний. */
  onRejected?: () => void;
}

/** Видалення від початку до кінця: рядок, потім файл його фото. */
export async function sendRecipeDelete(
  uid: string,
  id: string,
  options: RecipeDeleteOptions = {},
  backend: RecipeBackend = api,
): Promise<void> {
  const image = await backend.deleteRecipe(id);
  uploadedImages.delete(id);
  imageFailureNoted.delete(id);
  options.onDeleted?.();
  if (image) {
    await backend
      .deleteRecipeImageIfUnused(uid, image)
      .catch((error) => console.warn("[sync] фото видаленого рецепта не прибралось", error));
  }
}

/**
 * Видаляє рецепт у базі.
 *
 * Без входу чи бекенду нічого не робить: видалення тоді тримає позначка
 * pendingRecipeDeletes у сховищі стану, і його дошле наступне завантаження.
 */
export function pushRecipeDelete(id: string, options: RecipeDeleteOptions = {}) {
  if (!canSync()) return;
  const uid = userId as string;
  enqueueRecipe(
    id,
    "видалення рецепта",
    () => sendRecipeDelete(uid, id, options),
    (error) => {
      if (isPermanentRejection(error)) options.onRejected?.();
    },
  );
}

/**
 * Зберігає рецепт у базі. Якщо фото досі лежить як data:URL, вивантажує його
 * у сховище і повертає посилання — щоб важкий base64 не осідав ані в базі,
 * ані в localStorage.
 *
 * Без входу чи бекенду нічого не робить: правку тоді тримають позначки
 * unsyncedRecipes і unsyncedImages у сховищі стану, і її дошле наступне
 * завантаження.
 */
export function pushRecipe(recipe: Recipe, options: RecipePushOptions = {}) {
  if (!canSync()) return;
  const uid = userId as string;
  enqueueRecipe(
    recipe.id,
    "збереження рецепта",
    () => sendRecipe(uid, recipe, options),
    (error) => {
      if (isPermanentRejection(error)) options.onRejected?.();
    },
  );
}

/** Час запису з бази або з позначки — у мілісекундах. */
function stampMs(value: string | undefined): number {
  if (!value) return NaN;
  /*
   * Postgres віддає мікросекунди й інколи пробіл замість «T». Chrome таке
   * ковтає, а Safari — не завжди, тож приводимо до строгого ISO сам.
   */
  return Date.parse(
    value
      .replace(" ", "T")
      .replace(/(\.\d{3})\d+/, "$1")
      .replace(/([+-]\d{2})$/, "$1:00"),
  );
}

/** Незавершені записи рецептів, які живуть у localStorage: id → час дії. */
export interface RecipeMarks {
  /** Правка рядка, яку база ще не підтвердила. */
  rows: Record<string, string>;
  /** Змінене фото (нове, прибране), яке ще не записане в рядок. */
  images: Record<string, string>;
  /** Видалення, яке ще не дійшло. */
  deletes: Record<string, string>;
}

export interface RecipeMerge {
  recipes: Recipe[];
  /** Позначки, які лишаються в силі. */
  marks: RecipeMarks;
  /** Що треба дописати в базу ще раз: правка не дійшла і зараз не летить. */
  resend: Recipe[];
  /** Що треба видалити ще раз: база досі має рядок. */
  redelete: string[];
}

/**
 * Зводить власні рецепти з бази з локальними.
 *
 * База — джерело правди для всього, крім таких випадків.
 *
 * Запис рецепта ще в дорозі (або щойно долетів) — тоді стан рецепта цілком
 * локальний: і правка, і видалення. Інакше знімок, замовлений на мить раніше,
 * повертав стару версію, а та ще й осідала в localStorage.
 *
 * Є позначка рядка — правка так і не дійшла: застосунок приспали чи вбили
 * до запиту, не було мережі, ще не встигли увійти. Тоді порівнюємо час правки
 * з updated_at рядка: новіша локальна перемагає і їде в базу ще раз, старіша
 * поступається — отже, після неї рецепт уже змінили деінде. Рецепт без
 * updated_at — копія, яку ми самі щойно записали (перенесення після входу),
 * тож вона й перемагає.
 *
 * Є позначка фото — рядок долетів, а фото ні. За часом тут не звірити: сам
 * рядок уже зсунув updated_at за позначку. Тож текст беремо з бази, а фото —
 * локальне, і воно їде ще раз. Раніше позначка була одна на всю правку, і
 * після рядка, що встиг долетіти, база «перемагала» — нове фото мовчки
 * мінялось на старе.
 *
 * Є позначка видалення — рядок з бази не показуємо і видаляємо ще раз.
 *
 * Навмисні межі. Рецепт із позначкою рядка, якого в базі немає, лишається: це
 * найчастіше новий рецепт, що не встиг долетіти; зворотний бік — рецепт,
 * видалений на іншому пристрої, поки тут висіла недоставлена правка,
 * повернеться. І недоставлене фото перемагає фото, яке тим часом поставили
 * деінде. Позначки живуть секунди, тож на цей обмін можна піти.
 */
export function mergeRecipes(
  local: Recipe[],
  remote: api.StampedRecipe[],
  marks: RecipeMarks,
  inFlight: (id: string) => boolean = isRecipeInFlight,
): RecipeMerge {
  const localById = new Map(local.map((r) => [r.id, r]));
  const remoteIds = new Set(remote.map((r) => r.id));
  const recipes: Recipe[] = [];
  const kept: RecipeMarks = { rows: {}, images: {}, deletes: {} };
  const resend: Recipe[] = [];
  const redelete: string[] = [];

  const keepEdit = (id: string) => {
    if (marks.rows[id]) kept.rows[id] = marks.rows[id];
    if (marks.images[id]) kept.images[id] = marks.images[id];
  };

  // Видалення, що саме летить: рядок у базі ще може бути, а може вже й ні.
  for (const [id, at] of Object.entries(marks.deletes)) {
    if (inFlight(id) || remoteIds.has(id)) kept.deletes[id] = at;
  }

  // Нові рецепти, про які база ще не знає, — нагорі, як і створені.
  for (const r of local) {
    if (remoteIds.has(r.id) || marks.deletes[r.id]) continue;
    const at = marks.rows[r.id];
    if (!at && !inFlight(r.id)) continue;
    recipes.push(r);
    keepEdit(r.id);
    if (at && !inFlight(r.id)) resend.push(r);
  }

  for (const r of remote) {
    const mine = localById.get(r.id);

    if (inFlight(r.id)) {
      // Локально рецепта немає — його саме видаляють; відповідь бази застаріла.
      if (mine && !marks.deletes[r.id]) {
        recipes.push(mine);
        keepEdit(r.id);
      }
      continue;
    }

    if (marks.deletes[r.id]) {
      redelete.push(r.id);
      continue;
    }

    const at = marks.rows[r.id];
    if (mine && at && stampMs(at) > stampMs(r.updatedAt)) {
      recipes.push(mine);
      keepEdit(r.id);
      resend.push(mine);
      continue;
    }

    const photoAt = marks.images[r.id];
    if (mine && photoAt && (mine.image ?? null) !== (r.image ?? null)) {
      const merged: api.StampedRecipe = { ...r, image: mine.image ?? null };
      recipes.push(merged);
      kept.images[r.id] = photoAt;
      resend.push(merged);
      continue;
    }

    recipes.push(r);
  }

  return { recipes, marks: kept, resend, redelete };
}

export const pushDismissClear = () =>
  fire("приховані страви", (uid) => api.clearRelation("dismissed", uid));

export const pushPlanClear = () => fire("план", (uid) => api.clearPlan(uid, scope(uid)));
