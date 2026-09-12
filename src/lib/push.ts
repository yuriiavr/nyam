"use client";

import {
  deletePushSubscription,
  hasPushSubscription,
  savePushSubscription,
} from "./supabase/api";

/**
 * Пуш-сповіщення: підписка пристрою.
 *
 * Сам показ робить service worker, сервер лише надсилає. Тут — три речі:
 * спитати дозвіл, підписати пристрій і записати підписку в базу, щоб було
 * кому надсилати.
 *
 * Підписка належить пристрою, а не людині: з телефона й з ноутбука це два
 * різні рядки, і відписка на одному не глушить інший.
 */

/**
 * Публічний ключ беремо з сервера, а не зі змінної оточення.
 *
 * У браузер Next віддає лише змінні з префіксом NEXT_PUBLIC_, а таку змінну
 * не можна позначити sensitive у Vercel — і навпаки. Запит знімає це
 * протиріччя: ключ публічний за призначенням, і його однаково отримує кожен
 * пристрій, що підписується.
 */
let keyCache: string | null = null;

async function vapidKey(): Promise<string> {
  if (keyCache) return keyCache;
  try {
    const res = await fetch("/api/push/key", { headers: { Accept: "application/json" } });
    const data = (await res.json()) as { key?: string };
    // Порожнє не запамʼятовуємо: одна невдала спроба на слабкій мережі
    // інакше на всю сесію переконувала б застосунок, що сповіщень не буває.
    if (data.key) keyCache = data.key;
    return data.key ?? "";
  } catch {
    return "";
  }
}

/** Чи вміє цей браузер пуш. Чи налаштований сервер — питаємо окремо. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Чи є на сервері ключ, тобто чи є взагалі що вмикати. */
export async function pushConfigured(): Promise<boolean> {
  if (!pushSupported()) return false;
  return (await vapidKey()).length > 0;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * Ключ сервера у вигляді, якого хоче pushManager.
 *
 * base64url з пʼятьма-шістьма символами — це той самий ключ, але браузер
 * приймає лише сирі байти, тож переводимо руками.
 */
function keyToBytes(base64url: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);

  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  // Саме ArrayBuffer, а не Uint8Array: підпис pushManager вимагає цього типу.
  return bytes.buffer as ArrayBuffer;
}

/**
 * Реєстрація service worker — з підстраховкою.
 *
 * Раніше тут просто чекали на `navigator.serviceWorker.ready`, і це була
 * найдорожча стрічка в усьому пуші: коли реєстрації немає, ця обіцянка не
 * настає ніколи. Не помилка, не відмова — вічне очікування, від якого кнопка
 * крутиться без кінця, а екран налаштувань не показує взагалі нічого.
 *
 * Тому: якщо реєстрації немає — робимо її самі, а на очікування кладемо
 * таймер. Краще чесне «не вдалося», ніж мовчазна вічність.
 */
const READY_TIMEOUT_MS = 8000;

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;

  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (!existing) await navigator.serviceWorker.register("/sw.js");

    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), READY_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

/** Чи підписаний цей пристрій просто зараз. */
export async function pushActive(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await registration();
  return Boolean(await reg?.pushManager.getSubscription());
}

export type PushResult =
  | { state: "on" }
  | { state: "denied" }
  | { state: "unsupported"; reason: string }
  | { state: "failed"; reason: string };

/**
 * Чи знає про цей пристрій сервер.
 *
 * Питання не зайве: підписка живе у двох місцях — у браузері й у базі, — і
 * розійтись вони можуть тихо. Досі застосунок питав лише браузер, тож після
 * однієї невдалої відправки телефон назавжди показував «увімкнено», а
 * надсилати не було кому.
 */
export async function pushState(): Promise<{ browser: boolean; server: boolean }> {
  if (!pushSupported()) return { browser: false, server: false };

  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return { browser: false, server: false };

  const known = await hasPushSubscription(subscription.endpoint).catch(() => false);
  return { browser: true, server: known };
}

/**
 * Тихо відновлює запис про цей пристрій.
 *
 * Потрібно, бо адреса підписки з часом змінюється сама, а на iPhone події
 * про це не існує взагалі — там це єдиний спосіб полагодити. Виконується при
 * запуску: якщо браузер підписаний, а в базі його немає, дописуємо.
 */
export async function syncPushSubscription(userId: string): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;

  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

  await savePushSubscription({
    userId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    agent: navigator.userAgent.slice(0, 200),
  }).catch(() => undefined);
}

/**
 * Вмикає сповіщення на цьому пристрої.
 *
 * Дозвіл питаємо лише тут, у відповідь на натиск — браузери давно карають
 * за питання «просто так», а людина, яку спитали без приводу, тисне «ні»
 * назавжди.
 */
export async function enablePush(userId: string): Promise<PushResult> {
  if (!pushSupported()) return { state: "unsupported", reason: "браузер не вміє пуша" };

  /*
   * Дозвіл питаємо ПЕРШИМ, ще до будь-якого запиту в мережу.
   *
   * Safari дозволяє питати лише поки триває «дотик» — і будь-яке очікування
   * перед цим його з'їдає. Раніше тут спершу йшли по ключ на сервер, і на
   * iPhone вікно з дозволом просто не з'являлось: натиснув, кнопка блимнула,
   * нічого не сталось.
   */
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { state: "denied" };

  const key = await vapidKey();
  if (!key) return { state: "unsupported", reason: "сервер не віддав ключ" };

  try {
    const reg = await registration();
    if (!reg) return { state: "failed", reason: "service worker не зареєструвався" };

    const existing = await reg.pushManager.getSubscription();
    const subscription =
      existing ??
      (await reg.pushManager.subscribe({
        // Без цього браузер не доставить нічого, крім повідомлень із тілом,
        // а Chrome такі підписки просто не створює.
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(key),
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { state: "failed", reason: "браузер не дав ключів підписки" };
    }

    await savePushSubscription({
      userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      agent: navigator.userAgent.slice(0, 200),
    });
    return { state: "on" };
  } catch (error) {
    /*
     * Кажемо, що саме сталось. Раніше тут було просто «не вдалося» — і
     * через це порожня таблиця підписок місяцями виглядала б як «мабуть,
     * телефон не підтримує».
     */
    return {
      state: "failed",
      reason: error instanceof Error ? error.message : "невідома помилка",
    };
  }
}

/** Вимикає на цьому пристрої — і в браузері, і в базі. */
export async function disablePush(): Promise<void> {
  const reg = await registration();
  const subscription = await reg?.pushManager.getSubscription();
  if (!subscription) return;

  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => undefined);
  await deletePushSubscription(endpoint).catch(() => undefined);
}
