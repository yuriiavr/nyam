"use client";

import * as api from "./supabase/api";
import { friendlyError, getSupabase, isSupabaseConfigured } from "./supabase/client";
import { useApp } from "./store";
import { subscribeRealtime, unsubscribeRealtime } from "./realtime";
import { setSyncFamily, setSyncUser } from "./sync";
import type { Recipe } from "./types";
import { newId } from "./utils";

/**
 * Звʼязує авторизацію Supabase зі сховищем стану.
 *
 * Логіка входу:
 *   гість  → публічні рецепти з бази (RLS дозволяє читати), особисте локально;
 *   увійшов → усе особисте береться з бази, локальні рецепти переїжджають туди.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Завантажує публічну частину — працює і без входу. */
async function loadCommunity(myId: string | null) {
  const store = useApp.getState();
  try {
    const data = await api.fetchCommunity(myId);
    store.setCommunity(data);
    return true;
  } catch (error) {
    store.setSyncStatus("error", friendlyError(error));
    return false;
  }
}

/**
 * Переносить рецепти, створені до входу, в акаунт.
 * Локальні id можуть бути не-UUID (створені в старих версіях) — таким видаємо нові.
 */
async function migrateLocalRecipes(userId: string, remoteIds: Set<string>): Promise<Recipe[]> {
  const local = useApp.getState().myRecipes.filter((r) => !remoteIds.has(r.id));
  if (local.length === 0) return [];

  const uploaded: Recipe[] = [];
  for (const recipe of local) {
    const prepared: Recipe = {
      ...recipe,
      id: UUID_RE.test(recipe.id) ? recipe.id : newId(),
      authorId: userId,
      mine: true,
      // Посилання на оригінал зберігаємо лише якщо воно теж UUID з бази.
      sourceId: recipe.sourceId && UUID_RE.test(recipe.sourceId) ? recipe.sourceId : undefined,
    };

    try {
      let toSave = prepared;
      if (prepared.image?.startsWith("data:")) {
        try {
          const url = await api.uploadRecipeImage(userId, prepared.image, prepared.id);
          toSave = { ...prepared, image: url };
        } catch {
          toSave = { ...prepared, image: null };
        }
      }
      await api.upsertRecipe(toSave, userId);
      uploaded.push(toSave);
    } catch (error) {
      console.warn("[session] не вдалося перенести рецепт", recipe.title, error);
    }
  }
  return uploaded;
}

/** Тягне все, що стосується користувача, і кладе у сховище. */
async function loadUserData(userId: string, email: string) {
  const store = useApp.getState();
  store.setSyncStatus("loading");
  setSyncUser(userId);
  store.setAccount({ id: userId, email });

  try {
    // Сімʼю читаємо першою: від складу учасників залежить, які рядки
    // вважати спільними, тож наступні запити мають знати цей список.
    const memberIds = await loadFamily(userId);

    const [userState, myRecipes] = await Promise.all([
      api.fetchUserState(userId, memberIds),
      api.fetchMyRecipes(userId, memberIds),
    ]);

    const remoteIds = new Set(myRecipes.map((r) => r.id));
    const migrated = await migrateLocalRecipes(userId, remoteIds);

    store.applyRemoteUserState(userState, [...migrated, ...myRecipes]);

    // Спільноту перечитуємо, щоб побачити щойно перенесені рецепти.
    await loadCommunity(userId);
    await refreshNotifications();
    store.setSyncStatus("ready");

    // Далі за оновлення відповідає база: без цього нове сповіщення чи чужий
    // рецепт зʼявлялись би лише після перезапуску застосунку.
    subscribeRealtime(userId, {
      reloadCommunity: () => void loadCommunity(userId),
      reloadUserState: () => void refreshUserState(),
      reloadFamily: () => void refreshFamily(),
    });
  } catch (error) {
    store.setSyncStatus("error", friendlyError(error));
  }
}

/**
 * Читає сімʼю у сховище і повертає id учасників (разом із самим користувачем).
 * Помилка тут не має ламати вхід — без сімʼї застосунок просто працює як раніше.
 */
async function loadFamily(userId: string): Promise<string[]> {
  const store = useApp.getState();
  try {
    const data = await api.fetchFamily();
    if (!data) {
      store.setFamily(null, []);
      setSyncFamily([]);
      return [userId];
    }
    store.setFamily(data.family, data.members);
    const ids = data.members.map((m) => m.userId);
    const withMe = ids.includes(userId) ? ids : [...ids, userId];
    setSyncFamily(withMe);
    return withMe;
  } catch (error) {
    console.warn("[session] сімʼю не вдалося прочитати", error);
    store.setFamily(null, []);
    setSyncFamily([]);
    return [userId];
  }
}

/** Перечитує особисті та спільні дані, не чіпаючи сімʼю й спільноту. */
export async function refreshUserState(): Promise<void> {
  const store = useApp.getState();
  const account = store.account;
  if (!account) return;

  const memberIds = store.familyMembers.length
    ? store.familyMembers.map((m) => m.userId)
    : [account.id];

  try {
    const [userState, myRecipes] = await Promise.all([
      api.fetchUserState(account.id, memberIds),
      api.fetchMyRecipes(account.id, memberIds),
    ]);
    store.applyRemoteUserState(userState, myRecipes);
  } catch (error) {
    console.warn("[session] не вдалося оновити особисті дані", error);
  }
}

/** Перечитує сімʼю і всі залежні від неї дані — після створення/входу/виходу. */
export async function refreshFamily(): Promise<void> {
  const store = useApp.getState();
  const account = store.account;
  if (!account) return;

  const memberIds = await loadFamily(account.id);
  const [userState, myRecipes] = await Promise.all([
    api.fetchUserState(account.id, memberIds),
    api.fetchMyRecipes(account.id, memberIds),
  ]);
  store.applyRemoteUserState(userState, myRecipes);
}

export async function refreshNotifications(): Promise<void> {
  const store = useApp.getState();
  if (!store.account) return;
  try {
    store.setNotifications(await api.fetchNotifications());
  } catch (error) {
    console.warn("[session] сповіщення не вдалося прочитати", error);
  }
}

let initialised = false;

/** Викликається один раз при старті застосунку. */
export async function initSession(): Promise<() => void> {
  if (!isSupabaseConfigured) {
    useApp.getState().setSyncStatus("offline");
    return () => {};
  }
  if (initialised) return () => {};
  initialised = true;

  const sb = getSupabase();
  if (!sb) return () => {};

  const { data } = await sb.auth.getSession();
  const session = data.session;

  if (session?.user) {
    await loadUserData(session.user.id, session.user.email ?? "");
  } else {
    await loadCommunity(null);
    useApp.getState().setSyncStatus("ready");
  }

  const { data: listener } = sb.auth.onAuthStateChange((event, next) => {
    if (event === "SIGNED_IN" && next?.user) {
      const current = useApp.getState().account;
      if (current?.id === next.user.id) return; // вже завантажено
      void loadUserData(next.user.id, next.user.email ?? "");
    }
    if (event === "SIGNED_OUT") {
      setSyncUser(null);
      setSyncFamily([]);
      unsubscribeRealtime();
      useApp.getState().resetToLocal();
      void loadCommunity(null).then(() => useApp.getState().setSyncStatus("ready"));
    }
  });

  return () => {
    listener.subscription.unsubscribe();
    unsubscribeRealtime();
  };
}

/** Ручне перезавантаження — кнопка «оновити» в налаштуваннях. */
export async function refreshFromServer() {
  const account = useApp.getState().account;
  if (account) await loadUserData(account.id, account.email);
  else await loadCommunity(null);
}

/* ── Дії авторизації ──────────────────────────────────────────────────── */

export interface AuthResult {
  ok: boolean;
  message?: string;
  /** true — акаунт створено, але треба підтвердити пошту */
  needsConfirmation?: boolean;
}

export async function signUp(email: string, password: string, name: string): Promise<AuthResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Бекенд не налаштовано." };

  const { data, error } = await sb.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { name: name.trim() || undefined } },
  });

  if (error) return { ok: false, message: friendlyError(error) };
  if (data.user && !data.session) {
    return {
      ok: true,
      needsConfirmation: true,
      message: "Акаунт створено. Підтверди пошту за посиланням у листі.",
    };
  }
  return { ok: true };
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Бекенд не налаштовано." };

  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) return { ok: false, message: friendlyError(error) };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

export async function resetPassword(email: string): Promise<AuthResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Бекенд не налаштовано." };

  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth` : undefined,
  });
  if (error) return { ok: false, message: friendlyError(error) };
  return { ok: true, message: "Лист для відновлення надіслано." };
}

/* ── Вхід через Google ────────────────────────────────────────────────── */

/**
 * Які провайдери реально ввімкнені в проєкті.
 * Питаємо сам Supabase, щоб не показувати кнопку, яка гарантовано впаде.
 */
export async function fetchEnabledProviders(): Promise<Record<string, boolean> | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { external?: Record<string, boolean> };
    return json.external ?? {};
  } catch {
    // null = не дізнались. Викликач сам вирішує, що показувати.
    return null;
  }
}

export async function signInWithGoogle(): Promise<AuthResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Бекенд не налаштовано." };

  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: { prompt: "select_account" },
    },
  });

  // Успіх означає редірект на Google — далі керує браузер.
  if (error) return { ok: false, message: friendlyError(error) };
  return { ok: true };
}
