"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { SEED_PROFILES, SEED_RECIPES } from "@/data/seed";
import * as sync from "./sync";
import type {
  CookEvent,
  PantryItem,
  PlanSlot,
  Profile,
  Recipe,
  RecipeStats,
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
  plan: WeekPlan;
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
  following: string[];
  plan: WeekPlan;
  theme: "dark" | "light";
  onboarded: boolean;

  /* ── Бекенд ─────────────────────────────────────────────────────────── */
  /** Авторизований користувач; null — гість або локальний режим. */
  account: { id: string; email: string } | null;
  /** Рецепти спільноти з бази (кеш для офлайну). */
  remoteRecipes: Recipe[];
  remoteProfiles: Profile[];
  /** true — контент береться з бази, а не з демо-набору. */
  remoteReady: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;

  setHydrated: (v: boolean) => void;
  setTheme: (t: "dark" | "light") => void;
  setOnboarded: (v: boolean) => void;
  updateProfile: (patch: Partial<Profile>) => void;

  setAccount: (account: { id: string; email: string } | null) => void;
  setCommunity: (data: { recipes: Recipe[]; profiles: Profile[] }) => void;
  setSyncStatus: (status: SyncStatus, error?: string | null) => void;
  applyRemoteUserState: (data: RemoteUserState, myRecipes: Recipe[]) => void;
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

  addPantry: (item: PantryItem) => void;
  removePantry: (key: string) => void;
  clearPantry: () => void;

  addRecipe: (r: Recipe) => void;
  updateRecipe: (id: string, patch: Partial<Recipe>) => void;
  deleteRecipe: (id: string) => void;
  forkRecipe: (source: Recipe) => string;

  setPlanSlot: (day: string, slot: PlanSlot, recipeId: string | null) => void;
  clearPlan: () => void;
}

const emptyStats: RecipeStats = {
  likes: 0,
  saves: 0,
  cooks: 0,
  ratingSum: 0,
  ratingCount: 0,
};

const toggleIn = (arr: string[], id: string) =>
  arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];

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
      pantry: [],
      following: [],
      plan: {},
      theme: "dark",
      onboarded: false,

      account: null,
      remoteRecipes: [],
      remoteProfiles: [],
      remoteReady: false,
      syncStatus: "offline",
      syncError: null,

      setHydrated: (v) => set({ hydrated: v }),
      setTheme: (theme) => set({ theme }),
      setOnboarded: (onboarded) => set({ onboarded }),

      updateProfile: (patch) => {
        set({ profile: { ...get().profile, ...patch } });
        sync.pushProfile(patch);
      },

      setAccount: (account) => set({ account }),

      setCommunity: ({ recipes, profiles }) =>
        set({ remoteRecipes: recipes, remoteProfiles: profiles, remoteReady: true }),

      setSyncStatus: (syncStatus, syncError = null) => set({ syncStatus, syncError }),

      applyRemoteUserState: (data, myRecipes) =>
        set({
          profile: data.profile ?? get().profile,
          myRecipes,
          likes: data.likes,
          saved: data.saves,
          wishlist: data.wishlist,
          dismissed: data.dismissed,
          ratings: data.ratings,
          cooked: data.cooked,
          following: data.following,
          pantry: data.pantry,
          plan: data.plan,
        }),

      /** Вихід з акаунта — повертаємось до демо-режиму з чистим станом. */
      resetToLocal: () =>
        set({
          account: null,
          profile: defaultProfile,
          myRecipes: [],
          saved: [],
          likes: [],
          wishlist: [],
          dismissed: [],
          ratings: {},
          cooked: [],
          pantry: [],
          following: [],
          plan: {},
          syncStatus: "offline",
          syncError: null,
        }),

      toggleLike: (id) => {
        const next = toggleIn(get().likes, id);
        set({ likes: next });
        sync.pushLike(id, next.includes(id));
      },

      toggleSave: (id) => {
        const next = toggleIn(get().saved, id);
        set({ saved: next });
        sync.pushSave(id, next.includes(id));
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
        set({ ratings: { ...get().ratings, [id]: stars } });
        sync.pushRating(id, stars);
      },

      markCooked: (id) => {
        const at = new Date().toISOString();
        const wasWished = get().wishlist.includes(id);
        set({
          cooked: [{ recipeId: id, at }, ...get().cooked].slice(0, 400),
          wishlist: get().wishlist.filter((x) => x !== id),
        });
        sync.pushCook(id, at);
        if (wasWished) sync.pushWish(id, false);
      },

      addPantry: (item) => {
        const rest = get().pantry.filter((p) => p.key !== item.key);
        set({ pantry: [item, ...rest] });
        sync.pushPantryAdd(item);
      },

      removePantry: (key) => {
        set({ pantry: get().pantry.filter((p) => p.key !== key) });
        sync.pushPantryRemove(key);
      },

      clearPantry: () => {
        set({ pantry: [] });
        sync.pushPantryClear();
      },

      addRecipe: (r) => {
        set({ myRecipes: [r, ...get().myRecipes] });
        sync.pushRecipe(r, (url) => get().updateRecipe(r.id, { image: url }));
      },

      updateRecipe: (id, patch) => {
        const next = get().myRecipes.map((r) => (r.id === id ? { ...r, ...patch } : r));
        set({ myRecipes: next });
        const updated = next.find((r) => r.id === id);
        // Оновлення посилання на фото приходить із самого ж запису — не зациклюємось.
        if (updated && !("image" in patch && patch.image?.startsWith("http"))) {
          sync.pushRecipe(updated);
        }
      },

      deleteRecipe: (id) => {
        set({
          myRecipes: get().myRecipes.filter((r) => r.id !== id),
          saved: get().saved.filter((x) => x !== id),
          wishlist: get().wishlist.filter((x) => x !== id),
        });
        sync.pushRecipeDelete(id);
      },

      forkRecipe: (source) => {
        const id = newId();
        const copy: Recipe = {
          ...structuredClone(source),
          id,
          authorId: get().profile.id,
          sourceId: source.sourceId ?? source.id,
          createdAt: new Date().toISOString(),
          stats: { ...emptyStats },
          mine: true,
        };
        set({ myRecipes: [copy, ...get().myRecipes] });
        sync.pushRecipe(copy);
        return id;
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
      partialize: ({
        hydrated: _hydrated,
        account: _account,
        syncStatus: _syncStatus,
        syncError: _syncError,
        ...rest
      }) => rest,
      /**
       * Читаємо localStorage не під час створення стора, а вручну після
       * монтування (див. Providers). Тоді перший клієнтський рендер збігається
       * з серверним, контент видно одразу, а особисті дані підтягуються слідом.
       */
      skipHydration: true,
      onRehydrateStorage: () => (state) => state?.setHydrated(true),
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

export const pantryKeys = (state: AppState): string[] => state.pantry.map((p) => p.key);

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
