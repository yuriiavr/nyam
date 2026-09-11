"use client";

import { deletePushSubscription, savePushSubscription } from "./supabase/api";

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
  if (keyCache !== null) return keyCache;
  try {
    const res = await fetch("/api/push/key", { headers: { Accept: "application/json" } });
    const data = (await res.json()) as { key?: string };
    keyCache = data.key ?? "";
  } catch {
    keyCache = "";
  }
  return keyCache;
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

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.ready;
}

/** Чи підписаний цей пристрій просто зараз. */
export async function pushActive(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await registration();
  return Boolean(await reg?.pushManager.getSubscription());
}

export type PushResult = "on" | "denied" | "unsupported" | "failed";

/**
 * Вмикає сповіщення на цьому пристрої.
 *
 * Дозвіл питаємо лише тут, у відповідь на натиск — браузери давно карають
 * за питання «просто так», а людина, яку спитали без приводу, тисне «ні»
 * назавжди.
 */
export async function enablePush(userId: string): Promise<PushResult> {
  if (!pushSupported()) return "unsupported";

  const key = await vapidKey();
  if (!key) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  try {
    const reg = await registration();
    if (!reg) return "unsupported";

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
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "failed";

    await savePushSubscription({
      userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      agent: navigator.userAgent.slice(0, 200),
    });
    return "on";
  } catch {
    return "failed";
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
