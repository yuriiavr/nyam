"use client";

import type { DishParse, PantryChoice } from "./food-ai";
import type { CookedAnswer, CookedDish } from "./nutrition-ai";
import { getSupabase } from "./supabase/client";
import type { Nutrition, PackUnit } from "./types";

/**
 * Запити застосунку до маршрутів /api/food/*: ШІ для щоденника.
 *
 * Відповідь завжди одна з двох: результат або причина, з якої людині можна
 * сказати щось чесне («немає звʼязку», «на фото не видно етикетки»), а не
 * загальне «помилка».
 */

export type FoodAiFailure =
  | "nokey"
  | "unauthorized"
  | "throttled"
  | "upstream"
  | "unreadable"
  | "misconfigured"
  | "toobig"
  | "invalid"
  | "offline"
  | "cancelled";

export type FoodAiResult<T> = ({ ok: true } & T) | { ok: false; reason: FoodAiFailure };

export const FOOD_AI_MESSAGE: Record<FoodAiFailure, string> = {
  nokey: "ШІ не налаштований на сервері",
  unauthorized: "Увійди в акаунт — ШІ працює лише для своїх",
  throttled: "Забагато запитів поспіль — спробуй за кілька хвилин",
  upstream: "ШІ зараз не відповідає — спробуй ще раз",
  unreadable: "ШІ не впорався — спробуй інакше",
  misconfigured: "ШІ на сервері налаштований неправильно",
  toobig: "Фото завелике",
  invalid: "Нема що питати",
  offline: "Немає звʼязку",
  cancelled: "Скасовано",
};

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<FoodAiResult<T>> {
  const token = (await getSupabase()?.auth.getSession())?.data.session?.access_token;
  if (!token) return { ok: false, reason: "unauthorized" };

  // Своя межа очікування поверх кнопки «Скасувати»: AbortSignal.any старі Safari не знають.
  const local = new AbortController();
  const timer = setTimeout(() => local.abort(), 35_000);
  const cancel = () => local.abort();
  signal?.addEventListener("abort", cancel);

  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: local.signal,
    });
  } catch {
    if (signal?.aborted) return { ok: false, reason: "cancelled" };
    return { ok: false, reason: local.signal.aborted ? "upstream" : "offline" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
  try {
    const json = (await res.json()) as FoodAiResult<T>;
    return json && typeof json === "object" && "ok" in json ? json : { ok: false, reason: "upstream" };
  } catch {
    return { ok: false, reason: res.status === 413 ? "toobig" : "upstream" };
  }
}

export interface ProductAiAnswer {
  from: "ai" | "label";
  nutrition: Nutrition;
  note?: string;
  name?: string;
  brand?: string;
  packAmount?: number;
  packUnit?: PackUnit;
}

/** Оцінка КБЖВ товару за назвою. */
export const estimateProductNutrition = (
  q: { name: string; brand?: string; type?: string; fatPct?: number; pack?: string },
  signal?: AbortSignal,
) => post<ProductAiAnswer>("/api/food/product", q, signal);

/** КБЖВ з фото етикетки (data:URL після стиснення). */
export const readNutritionLabel = (image: string, signal?: AbortSignal) =>
  post<ProductAiAnswer>("/api/food/product", { image }, signal);

/** «Що зʼїв» словами → продукти й рядки комори. */
export const parseEatenDish = (text: string, pantry: PantryChoice[], signal?: AbortSignal) =>
  post<{ dish: DishParse }>("/api/food/dish", { text, pantry }, signal);

/** Склад, як його справді зварили, → КБЖВ страви й сира вага того, що зважили готовим. */
export const countCookedDish = (dish: CookedDish, signal?: AbortSignal) =>
  post<CookedAnswer>("/api/food/cooked", dish, signal);
