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

export function setSyncUser(id: string | null) {
  userId = id;
}

export function getSyncUser(): string | null {
  return userId;
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
  fire("збереження", (uid) => api.setRelation("saves", uid, recipeId, on));

export const pushWish = (recipeId: string, on: boolean) =>
  fire("список бажань", (uid) => api.setRelation("wishlist", uid, recipeId, on));

export const pushDismiss = (recipeId: string, on: boolean) =>
  fire("приховування", (uid) => api.setRelation("dismissed", uid, recipeId, on));

export const pushRating = (recipeId: string, stars: number) =>
  fire("оцінка", (uid) => api.setRating(uid, recipeId, stars));

export const pushCook = (recipeId: string, at: string) =>
  fire("історія готування", (uid) => api.addCook(uid, recipeId, at));

export const pushFollow = (profileId: string, on: boolean) =>
  fire("підписка", (uid) => api.setFollow(uid, profileId, on));

/* ── Комора і план ────────────────────────────────────────────────────── */

export const pushPantryAdd = (item: PantryItem) =>
  fire("комора", (uid) => api.upsertPantryItem(uid, item));

export const pushPantryRemove = (key: string) =>
  fire("комора", (uid) => api.deletePantryItem(uid, key));

export const pushPantryClear = () => fire("комора", (uid) => api.clearPantry(uid));

export const pushPlanSlot = (day: string, slot: PlanSlot, recipeId: string | null) =>
  fire("план", (uid) => api.setPlanSlot(uid, day, slot, recipeId));

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

export const pushPlanClear = () => fire("план", (uid) => api.clearPlan(uid));
