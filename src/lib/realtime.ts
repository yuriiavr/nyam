"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { CustomIngredientRow } from "./supabase/api";
import { getSupabase } from "./supabase/client";
import { useApp } from "./store";
import { isRecipeInFlight } from "./sync";
import type { AppNotification } from "./types";

/**
 * Живі оновлення через Supabase Realtime.
 *
 * До цього застосунок читав дані один раз при старті, тому нове сповіщення
 * чи чужий рецепт зʼявлялись лише після перезапуску. Тепер база сама
 * повідомляє про зміни.
 *
 * RLS діє й тут: Supabase перевіряє політики для підключеного користувача,
 * тож у канал не потрапить те, чого людині не видно і так.
 */

/** Скільки чекати перед перезавантаженням після сплеску подій. */
const DEBOUNCE_MS = 800;

function debounce(fn: () => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
  run.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return run;
}

interface Handlers {
  /** Перечитати спільноту — зʼявився або змінився чужий рецепт. */
  reloadCommunity: () => void;
  /** Перечитати особисте — сімʼя щось поклала в комору чи план. */
  reloadUserState: () => void;
  /** Склад сімʼї змінився — треба перечитати і її, і залежні дані. */
  reloadFamily: () => void;
}

let channel: RealtimeChannel | null = null;

/**
 * Підписується на зміни. Повертає функцію відписки.
 * Повторний виклик спершу прибирає попередню підписку — щоб при
 * переавторизації не лишалось двох каналів.
 */
export function subscribeRealtime(userId: string, handlers: Handlers): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};

  unsubscribeRealtime();

  const community = debounce(handlers.reloadCommunity, DEBOUNCE_MS);
  const userState = debounce(handlers.reloadUserState, DEBOUNCE_MS);
  const family = debounce(handlers.reloadFamily, DEBOUNCE_MS);

  channel = sb
    .channel("nyam-live")

    // Сповіщення прилітають готовим рядком — дописуємо в стан без запиту.
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = payload.new as {
          id: string;
          type: AppNotification["type"];
          actor_id: string | null;
          recipe_id: string | null;
          read_at: string | null;
          created_at: string;
        };
        const store = useApp.getState();
        if (store.notifications.some((n) => n.id === row.id)) return;
        store.setNotifications([
          {
            id: row.id,
            type: row.type,
            actorId: row.actor_id,
            recipeId: row.recipe_id,
            readAt: row.read_at,
            createdAt: row.created_at,
          },
          ...store.notifications,
        ]);
      },
    )

    /* Рецепти перечитуємо цілком, а не патчимо рядком: у стрічці показуються
       лічильники з вʼюхи recipes_with_stats, яких у сирій події немає. */
    .on("postgres_changes", { event: "*", schema: "public", table: "recipes" }, (payload) => {
      const row = payload.new as { id?: string; author_id?: string } | null;
      const id = row?.id ?? (payload.old as { id?: string } | null)?.id;
      /*
       * Власні рецепти й рецепти сімʼї лежать у myRecipes, а екрани беруть саме
       * ту копію, не стрічку. Без перечитування особистого правка чи нове фото
       * з іншого пристрою чи від іншого учасника не зʼявлялись до перезапуску.
       * А старе фото тепер ще й прибирається зі сховища: застаріла копія
       * показувала б порожню рамку.
       *
       * Власний запис цього пристрою пропускаємо: поки він у дорозі (і ще
       * трохи після), подія — майже напевно відлуння його ж, а стан і так
       * локальний. Решту своїх подій — з іншого пристрою — перечитуємо.
       */
      const { myRecipes, familyMembers } = useApp.getState();
      const known = id ? myRecipes.some((r) => r.id === id) : false;
      // Новий рецепт ще не має копії — впізнаємо за автором: сам або сімʼя.
      const fresh =
        !!row?.author_id &&
        (row.author_id === userId || familyMembers.some((m) => m.userId === row.author_id));
      if ((known || fresh) && !(id && isRecipeInFlight(id))) userState();

      if (payload.eventType === "DELETE") {
        if (id) {
          const store = useApp.getState();
          store.setCommunity({
            recipes: store.remoteRecipes.filter((r) => r.id !== id),
            profiles: store.remoteProfiles,
          });
        }
        return;
      }
      community();
    })

    /*
     * Спільні комора й план — щоб холодильник сімʼї сходився в обох. Перечитування
     * комори на подію докачує лише картки товарів, яких ще немає в кеші (A7):
     * таблиць товарів у публікації навмисно немає, а зміну типу картки тригер
     * products_type_to_pantry однаково приносить сюди подіями рядків комори.
     */
    .on("postgres_changes", { event: "*", schema: "public", table: "pantry_items" }, userState)
    .on("postgres_changes", { event: "*", schema: "public", table: "plan_slots" }, userState)
    // І список покупок: один пішов у магазин, другий дописує з дому.
    .on("postgres_changes", { event: "*", schema: "public", table: "shopping_items" }, userState)

    /*
     * Дописаний тип приїжджає готовим рядком — латаємо реєстр без перечитування
     * всієї спільноти (A7): з вікі-правкою типів (I3) подій стало більше, а
     * чотириста рецептів на кожну — марна мережа. Рядок без ключа чи назви
     * (видалення, якого в нас не буває, або урізана подія) — старим шляхом.
     */
    .on("postgres_changes", { event: "*", schema: "public", table: "custom_ingredients" }, (payload) => {
      const row = payload.new as (Partial<CustomIngredientRow> & { key?: string; label?: string }) | null;
      if (payload.eventType !== "DELETE" && row?.key && row.label) {
        useApp.getState().upsertCustomIngredientRow(row as CustomIngredientRow);
        return;
      }
      community();
    })

    // Хтось увійшов або вийшов із сімʼї — змінюється сам склад спільних даних.
    .on("postgres_changes", { event: "*", schema: "public", table: "family_members" }, family)

    .subscribe();

  return () => {
    community.cancel();
    userState.cancel();
    family.cancel();
    unsubscribeRealtime();
  };
}

export function unsubscribeRealtime() {
  const sb = getSupabase();
  if (channel && sb) {
    void sb.removeChannel(channel);
  }
  channel = null;
}
