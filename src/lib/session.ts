"use client";

import * as api from "./supabase/api";
import { friendlyError, getSupabase, isSupabaseConfigured } from "./supabase/client";
import { useApp } from "./store";
import { subscribeRealtime, unsubscribeRealtime } from "./realtime";
import { pushCustomIngredient, setSyncFamily, setSyncUser } from "./sync";
import type { IngredientDef, Recipe } from "./types";
import { newId } from "./utils";

/**
 * Звʼязує авторизацію Supabase зі сховищем стану.
 *
 * Без акаунта застосунком користуватись не можна — гостьового режиму немає,
 * і єдиний спосіб увійти це Google (див. AuthScreen). Тому поки сесії немає,
 * дані з бази не тягнемо взагалі: показувати їх все одно нема кому.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Завантажує публічну частину — працює і без входу. */
async function loadCommunity(myId: string | null) {
  const store = useApp.getState();
  try {
    /*
     * Каталог, дописаний людьми, приїжджає разом зі спільнотою, а не з
     * особистими даними: чужий рецепт може посилатись на чужий продукт, і
     * без нього в стрічці замість назви був би сирий ключ.
     */
    const [data, custom] = await Promise.all([
      api.fetchCommunity(myId),
      api.fetchCustomIngredients().catch(() => [] as IngredientDef[]),
    ]);
    /*
     * Каталог ставимо ПЕРШИМ, ще до рецептів. Інакше екрани перемальовуються
     * від нових рецептів, коли опису продукту ще немає, — і рядок показує
     * сирий ключ до наступного оновлення.
     *
     * Створене без мережі живе лише тут: знімок бази про такий продукт ще не
     * знає, а рецепт із ним уже міг поїхати у спільноту. Просто підставити
     * знімок означало б стерти продукт, і рядок рецепта показав би сирий
     * ключ. Тому зливаємо й дописуємо те, що не долетіло, — так само, як це
     * робить migrateLocalRecipes для самих рецептів.
     */
    const known = new Set(custom.map((d) => d.key));
    const unsynced = useApp.getState().customIngredients.filter((d) => !known.has(d.key));
    store.setCustomIngredients([...unsynced, ...custom]);
    for (const def of unsynced) pushCustomIngredient(def);

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

/** Посилання на знімок із Google: у метаданих воно лежить під двома назвами. */
function googlePhoto(user: { user_metadata?: Record<string, unknown> }): string | undefined {
  const meta = user.user_metadata ?? {};
  const url = meta.avatar_url ?? meta.picture;
  return typeof url === "string" && url ? url : undefined;
}

/**
 * Тягне все, що стосується користувача, і кладе у сховище.
 *
 * `photo` — знімок із Google. Тримаємо його окремо від аватара профілю: той
 * можна замінити емодзі, і тоді посилання на фото загубилося б назовсім, а
 * так його завжди можна обрати назад.
 */
async function loadUserData(userId: string, email: string, photo?: string) {
  const store = useApp.getState();
  store.setSyncStatus("loading");
  setSyncUser(userId);
  store.setAccount({ id: userId, email, photo });

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
    lastLoadedAt = Date.now();

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
    // Без бекенду входу не існує — воротар покаже, чого бракує.
    useApp.getState().setSyncStatus("offline");
    useApp.getState().setAuthChecked(true);
    return () => {};
  }
  if (initialised) return () => {};
  initialised = true;

  const sb = getSupabase();
  if (!sb) return () => {};

  const { data } = await sb.auth.getSession();
  const session = data.session;

  if (session?.user) {
    await loadUserData(session.user.id, session.user.email ?? "", googlePhoto(session.user));
  } else {
    useApp.getState().setSyncStatus("ready");
  }
  // З цієї миті відомо напевно, увійшов користувач чи ні. До неї воротар
  // тримає заставку: інакше на секунду блимав би екран входу тому, хто
  // насправді має живу сесію.
  useApp.getState().setAuthChecked(true);

  const { data: listener } = sb.auth.onAuthStateChange((event, next) => {
    if (event === "SIGNED_IN" && next?.user) {
      const current = useApp.getState().account;
      if (current?.id === next.user.id) return; // вже завантажено
      void loadUserData(next.user.id, next.user.email ?? "", googlePhoto(next.user));
    }
    if (event === "SIGNED_OUT") {
      setSyncUser(null);
      setSyncFamily([]);
      unsubscribeRealtime();
      useApp.getState().resetToLocal();
      useApp.getState().setAuthChecked(true);
      useApp.getState().setSyncStatus("ready");
    }
  });

  return () => {
    listener.subscription.unsubscribe();
    unsubscribeRealtime();
  };
}

/** Коли востаннє все перечитували з бази. */
let lastLoadedAt = 0;

/** Ручне перезавантаження: потягування згори або повернення у стрічку. */
export async function refreshFromServer() {
  const account = useApp.getState().account;
  if (account) await loadUserData(account.id, account.email, account.photo);
}

/**
 * Те саме, але тільки якщо дані вже підстаркуваті.
 *
 * Викликається на вхід у стрічку, а туди заходять часто — по кілька разів за
 * хвилину, перемикаючись між вкладками. Перечитувати всю базу щоразу означало
 * б смикати мережу заради того, що й так щойно прочитано; realtime тим часом
 * приносить чуже свіже сам.
 */
export async function refreshIfStale(maxAgeMs = 60_000): Promise<void> {
  if (Date.now() - lastLoadedAt < maxAgeMs) return;
  await refreshFromServer();
}

/* ── Дії авторизації ──────────────────────────────────────────────────── */

export interface AuthResult {
  ok: boolean;
  message?: string;
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

/* ── Вхід через Google ────────────────────────────────────────────────── */

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
