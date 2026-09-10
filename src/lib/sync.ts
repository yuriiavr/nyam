"use client";

import * as api from "./supabase/api";
import { friendlyError, isSupabaseConfigured } from "./supabase/client";
import type { PantryItem, PlanSlot, Profile, Recipe } from "./types";

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
) {
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      fire(context, run);
    }, delayMs),
  );
}

/**
 * Чи є для цього продукту запис, який ще не полетів у базу.
 *
 * Потрібно тому, що відповідь бази може прийти раніше за наш власний
 * відкладений запис: користувач вводить «200», realtime приносить знімок
 * комори, де цього числа ще немає, і воно зникає з поля просто під час
 * набору. Такі продукти лишаємо в локальному стані до запису.
 */
export function hasPendingPantryWrite(key: string): boolean {
  return pending.has(`pantry:${key}`);
}

/* ── Комора і план ────────────────────────────────────────────────────── */

export const pushPantryAdd = (item: PantryItem) =>
  fireDebounced("комора", `pantry:${item.key}`, 500, (uid) =>
    api.upsertPantryItem(uid, item),
  );

/**
 * Скільки продукт із чека вважається «щойно записаним».
 *
 * Свідомо більше за 800 мс, з якими realtime відкладає перезавантаження
 * стану: інакше знімок, замовлений чужою подією, встигав прийти без наших
 * позицій і зітерти щойно внесений чек.
 */
const BULK_GUARD_MS = 3000;

/**
 * Запис цілого чека одним запитом.
 *
 * Позначку «запис у польоті» ставимо на кожен продукт до відправлення, а не
 * після: саме за нею mergePantry впізнає те, чого в базі ще немає, і не дає
 * відповіді бази затерти свіжий імпорт.
 */
export const pushPantryBulk = (items: PantryItem[]) => {
  if (items.length === 0) return;

  for (const item of items) {
    const key = `pantry:${item.key}`;
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);
    // Таймер-вартовий нічого не пише — він лише тримає ознаку запису.
    pending.set(key, setTimeout(() => pending.delete(key), BULK_GUARD_MS));
  }

  fire("комора", (uid) =>
    // Продукт, який устигли прибрати з комори, поки чек летів, у пакет не
    // потрапляє: pushPantryRemove знімає його позначку, і це наш сигнал.
    api.upsertPantryItems(uid, items.filter((item) => pending.has(`pantry:${item.key}`))),
  );
};

export const pushPantryRemove = (key: string) => {
  // Знімаємо відкладений запис: інакше він відтворив би щойно видалений рядок.
  const timer = pending.get(`pantry:${key}`);
  if (timer) {
    clearTimeout(timer);
    pending.delete(`pantry:${key}`);
  }
  fire("комора", (uid) => api.deletePantryItem(uid, key, scope(uid)));
};

export const pushPantryClear = () => {
  for (const [key, timer] of pending) {
    if (key.startsWith("pantry:")) {
      clearTimeout(timer);
      pending.delete(key);
    }
  }
  fire("комора", (uid) => api.clearPantry(uid, scope(uid)));
};

export const pushPlanSlot = (day: string, slot: PlanSlot, recipeId: string | null) =>
  fire("план", (uid) => api.setPlanSlot(uid, day, slot, recipeId, scope(uid)));

export const pushProfile = (patch: Partial<Profile>) =>
  fire("профіль", (uid) => api.updateProfile(uid, patch));

/* ── Рецепти ──────────────────────────────────────────────────────────── */

export const pushRecipeDelete = (id: string) =>
  fire("видалення рецепта", () => api.deleteRecipe(id));

/**
 * Зберігає рецепт у базі. Якщо фото досі лежить як data:URL, спершу
 * вивантажує його у сховище і повертає нове посилання — щоб важкий base64
 * не осідав ані в базі, ані в localStorage.
 */
export function pushRecipe(recipe: Recipe, onImageUploaded?: (url: string) => void) {
  fire("збереження рецепта", async (uid) => {
    let toSave = recipe;

    if (recipe.image?.startsWith("data:")) {
      try {
        const url = await api.uploadRecipeImage(uid, recipe.image, recipe.id);
        toSave = { ...recipe, image: url };
        onImageUploaded?.(url);
      } catch (error) {
        // Фото не критичне — рецепт усе одно має зберегтися.
        report(error, "завантаження фото");
        toSave = { ...recipe, image: null };
      }
    }

    await api.upsertRecipe(toSave, uid);
  });
}

export const pushDismissClear = () =>
  fire("приховані страви", (uid) => api.clearRelation("dismissed", uid));

export const pushPlanClear = () => fire("план", (uid) => api.clearPlan(uid, scope(uid)));
