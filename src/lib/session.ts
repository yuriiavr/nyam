"use client";

import * as api from "./supabase/api";
import { friendlyError, getSupabase, isSupabaseConfigured } from "./supabase/client";
import { fetchProductsByIds } from "./supabase/products-api";
import { useApp, type RemoteUserState } from "./store";
import { disablePush } from "./push";
import { subscribeRealtime, unsubscribeRealtime } from "./realtime";
import { isRecipeInFlight, pushCustomIngredientsInOrder, setSyncFamily, setSyncUser } from "./sync";
import type { IngredientDef, Product, Recipe } from "./types";
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
    // Одним викликом і по черзі: різновид не ляже в базу раніше за свого батька.
    pushCustomIngredientsInOrder(unsynced);

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
  const { myRecipes, unsyncedRecipes, unsyncedImages } = useApp.getState();
  const local = myRecipes.filter(
    (r) =>
      !remoteIds.has(r.id) &&
      /*
       * Рецепт із позначкою недоставленої правки чи з записом у дорозі шле
       * sync — зі своєю чергою, фото і позначкою (див. applyRemoteUserState).
       * Друга, паралельна відправка тут вантажила б те саме фото двічі.
       */
      !unsyncedRecipes[r.id] &&
      !unsyncedImages[r.id] &&
      !isRecipeInFlight(r.id) &&
      /*
       * Власний рецепт, який уже побував у базі (має updated_at), а тепер його
       * там немає, — видалений на іншому пристрої. Переносити його — означає
       * воскресити для всіх: так і було, щойно цей пристрій перечитував базу.
       */
      !(r.authorId === userId && (r as api.StampedRecipe).updatedAt) &&
      /*
       * Чужий рецепт (сімʼї), якого вже не видно, — не наш, щоб «переносити»:
       * upsert від свого імені або відбивався б RLS, або, якщо автор його
       * видалив, тихо привласнював би копію.
       */
      !(UUID_RE.test(r.authorId) && r.authorId !== userId),
  );
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

/**
 * Знімок особистого разом із картками, на які посилається комора (A7, D4).
 *
 * Картки тягнемо ДО того, як знімок ляже в стан: інакше рядок на мить показав
 * би назву типу («Молоко») замість «Галичина 2,5%» і перестрибнув би.
 *
 * - `revalidate: true` (повне завантаження, refreshIfStale, сімʼя) — усі
 *   картки комори заново: так приїжджають перейменування й нові упаковки;
 * - `revalidate: false` (подія realtime) — лише ті, яких у кеші ще немає; немає
 *   таких — жодного запиту. Зміну типу картки realtime і так приносить рядками
 *   комори (тригер products_type_to_pantry), а назва оновиться на повному.
 *
 * Картки не вдалось прочитати — знімок однаково застосовуємо: комора без
 * назв товарів краща за комору, що не оновилась.
 */
async function withProducts(
  userState: Omit<RemoteUserState, "products" | "productsComplete">,
  revalidate: boolean,
): Promise<RemoteUserState> {
  const referenced = [...new Set(userState.pantry.flatMap((row) => (row.productId ? [row.productId] : [])))];
  const cached = useApp.getState().products;
  const wanted = revalidate ? referenced : referenced.filter((id) => !cached[id]);
  if (wanted.length === 0) return { ...userState, products: [], productsComplete: revalidate };
  try {
    const products: Product[] = await fetchProductsByIds(wanted);
    return { ...userState, products, productsComplete: revalidate };
  } catch (error) {
    console.warn("[session] картки товарів не вдалося прочитати", error);
    // Кеш не підрізаємо: без відповіді не знаємо, що з нього ще потрібне.
    return { ...userState, products: [], productsComplete: false };
  }
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
    const [migrated, withCards] = await Promise.all([
      migrateLocalRecipes(userId, remoteIds),
      withProducts(userState, true),
    ]);

    store.applyRemoteUserState(withCards, [...migrated, ...myRecipes]);

    // Спільноту перечитуємо, щоб побачити щойно перенесені рецепти.
    await loadCommunity(userId);
    await refreshNotifications();
    store.setSyncStatus("ready");
    lastLoadedAt = Date.now();

    // Далі за оновлення відповідає база: без цього нове сповіщення чи чужий
    // рецепт зʼявлялись би лише після перезапуску застосунку.
    subscribeRealtime(userId, {
      reloadCommunity: () => void loadCommunity(userId),
      // Подія realtime — лише відсутні картки, без перечитування всіх (A7).
      reloadUserState: () => void refreshUserState({ revalidateProducts: false }),
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

/**
 * Перечитує особисті та спільні дані, не чіпаючи сімʼю й спільноту.
 *
 * `revalidateProducts` — чи перечитати всі картки комори (true, типово) чи
 * лише докачати відсутні (false — так кличе realtime на кожну подію).
 */
export async function refreshUserState(opts: { revalidateProducts?: boolean } = {}): Promise<void> {
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
    store.applyRemoteUserState(await withProducts(userState, opts.revalidateProducts ?? true), myRecipes);
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
  // Склад сімʼї змінився — з ним і комора, тож картки перечитуємо всі.
  store.applyRemoteUserState(await withProducts(userState, true), myRecipes);
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

/**
 * Викликається один раз при старті застосунку.
 *
 * Що б тут не сталось, authChecked має стати true: доки він false, воротар
 * тримає заставку — і будь-який виняток на шляху лишає людину назавжди з
 * крутілкою, без екрана входу, без помилки, без жодного натяку. Саме так
 * виглядав деплой із порожнім NEXT_PUBLIC_SUPABASE_URL: createClient кинув
 * «Invalid supabaseUrl», проміс відхилився нікуди, і застосунок не вмикався.
 */
export async function initSession(): Promise<() => void> {
  if (!isSupabaseConfigured) {
    // Без бекенду входу не існує — воротар покаже, чого бракує.
    useApp.getState().setSyncStatus("offline");
    useApp.getState().setAuthChecked(true);
    return () => {};
  }
  /*
   * Повторний виклик (строгий режим dev) authChecked не чіпає: перший ще
   * вантажить дані, і «перевірку завершено» тут означало б блиск екрана
   * входу перед тим, хто насправді має живу сесію.
   */
  if (initialised) return () => {};
  initialised = true;

  try {
    return await openSession();
  } catch (error) {
    console.error("[session] сесію не вдалося підняти", error);
    useApp.getState().setSyncStatus("error", friendlyError(error));
    useApp.getState().setAuthChecked(true);
    return () => {};
  }
}

/** Власне робота: сесія, дані, підписка на зміни входу. */
async function openSession(): Promise<() => void> {
  const sb = getSupabase();
  if (!sb) {
    // Налаштування є, а клієнта немає — про причину вже сказано в консолі.
    useApp.getState().setSyncStatus("offline");
    useApp.getState().setAuthChecked(true);
    return () => {};
  }

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
  /*
   * Сповіщення цього пристрою знімаємо ДО виходу, поки сесія ще жива: рядок
   * підписки база дозволяє видалити лише власнику. Після виходу він лишався б
   * у базі, телефон і далі отримував би сповіщення попереднього акаунта, а
   * наступний, хто увійде, не зміг би записати цей пристрій на себе.
   *
   * Відповідь про сповіщення (pushOffer) при цьому лишається: вона про
   * пристрій, а не про акаунт. Хто вмикав, після входу отримає пропозицію
   * знову — цього разу вже без вікна дозволу.
   */
  await disablePush().catch(() => undefined);
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
