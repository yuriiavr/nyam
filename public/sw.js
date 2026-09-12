/* Ням — service worker: офлайн-оболонка + кешування статики. */

const VERSION = "nyam-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const PAGE_CACHE = `${VERSION}-pages`;

const SHELL = ["/", "/offline", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/* ── Пуш-сповіщення ───────────────────────────────────────────────────── */

/**
 * Показ повідомлення. Приходить від сервера як JSON; якщо тіло зіпсоване,
 * показуємо бодай щось — мовчазний пуш виглядав би як збій пристрою.
 */
/**
 * Підписка змінила адресу.
 *
 * Браузер робить це сам — раз на кілька місяців або після оновлення, — і зі
 * старою адресою сповіщення просто перестають приходити. Мовчки: ніхто
 * нікого не попереджає, крім оцієї події.
 *
 * Підписуємось наново тим самим ключем (беремо з сервера, бо в події
 * `oldSubscription.options` сучасний Chrome лишає порожнім) і кажемо серверу
 * обидві адреси — щоб він переписав свій рядок, а не завів другий.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch("/api/push/key", { headers: { Accept: "application/json" } });
        const { key } = await res.json();
        if (!key) return;

        const padding = "=".repeat((4 - (key.length % 4)) % 4);
        const raw = atob((key + padding).replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);

        const fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        });

        const json = fresh.toJSON();
        await fetch("/api/push/rotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            old: event.oldSubscription?.endpoint,
            endpoint: json.endpoint,
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth,
          }),
        });
      } catch {
        /* наступний запуск застосунку перепише підписку сам */
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Ням";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: "/api/icon?size=192",
      badge: "/api/icon?size=192",
      lang: "uk",
      // Тег склеює повторні сповіщення про те саме: щоденне нагадування про
      // строки не має накопичуватись стосом за тиждень.
      tag: payload.tag || undefined,
      renotify: Boolean(payload.tag),
      data: { url: payload.url || "/" },
    }),
  );
});

/** Натиск на сповіщення веде туди, звідки воно прийшло. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // Уже відкритий застосунок не піднімаємо вдруге, а просто переводимо.
      for (const client of windows) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

/* ── Кеш ──────────────────────────────────────────────────────────────── */

const isAsset = (url) =>
  url.pathname.startsWith("/_next/static/") ||
  url.pathname.startsWith("/api/icon") ||
  /\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Зовнішні API (Open Food Facts, Open-Meteo) — тільки мережа, без кешу.
  if (url.origin !== self.location.origin) return;

  // Статика — cache-first: вона незмінна за хешем у назві.
  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Навігація — network-first із фолбеком на кеш, далі на офлайн-сторінку.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || caches.match("/offline"))
            .then((cached) => cached || caches.match("/")),
        ),
    );
  }
});
