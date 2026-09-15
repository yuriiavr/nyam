"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { ToastProvider, useToast } from "./ui";
import { UpdateGate } from "./UpdateBanner";
import { useApp } from "@/lib/store";
import { useCooking } from "@/lib/cooking";
import { initSession } from "@/lib/session";
import { onSyncError } from "@/lib/sync";
import { initInstallPrompt } from "@/lib/pwa";
import { syncPushSubscription } from "@/lib/push";
import {
  CLIENT_SCHEMA,
  STALE_WRITE_MESSAGE,
  VERSION_RETRY_BASE_MS,
  markClientStale,
  readServerSchema,
  shouldPromptReload,
} from "@/lib/schema-version";
import { isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Реєстрація service worker — тільки в проді, щоб не ламати HMR.
 *
 * Раніше реєстрація чекала на подію `load`, і це коштувало нам усіх
 * пуш-сповіщень. Ефекти React виконуються після гідратації, а на телефоні
 * вона часто закінчується вже ПІСЛЯ `load`: подія минула, слухач чекає на
 * неї вічно, service worker не реєструється — а разом із ним мовчки зникають
 * і офлайн, і пуш, бо `serviceWorker.ready` тоді не настає ніколи.
 *
 * Тому дивимось на стан сторінки, а не на подію: якщо вона вже завантажена,
 * реєструємо одразу.
 */
function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* офлайн-режим просто не увімкнеться */
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);
}

/**
 * Синхронізує вибрану тему з атрибутом на <html> і кольором смуги браузера.
 *
 * Колір смуги задаємо одним тегом без media-запиту — і саме тому його не
 * можна лишати списком у viewport. Зі списком Next малює два теги, по одному
 * на системну тему, а браузер обирає з них сам. Виходило так: у застосунку
 * темна тема, у телефоні світла — і смуга вгорі малювалась кремовою поверх
 * майже чорної сторінки. Тема тут наша, а не системна, тож і колір має бути
 * один, наш.
 */
function useTheme() {
  const theme = useApp((s) => s.theme);
  const hydrated = useApp((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.theme = theme;

    const color = theme === "light" ? "#fff8f3" : "#0d0a09";
    const metas = document.querySelectorAll('meta[name="theme-color"]');

    // Зайві теги з попередніх версій розмітки прибираємо: поки вони є,
    // браузер має з чого вибирати, і вибирає не те.
    metas.forEach((meta, i) => {
      if (i > 0) {
        meta.remove();
        return;
      }
      meta.removeAttribute("media");
      meta.setAttribute("content", color);
    });

    if (metas.length === 0) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.content = color;
      document.head.appendChild(meta);
    }
  }, [theme, hydrated]);
}

/** Підтягує збережений стан після монтування — без розбіжностей гідрації. */
function useRehydrate() {
  useEffect(() => {
    useApp.persist.rehydrate();
    if (!useApp.getState().hydrated) useApp.getState().setHydrated(true);
    // Готування й таймери — окреме сховище цього пристрою (src/lib/cooking.ts).
    void useCooking.persist.rehydrate();
  }, []);
}

/** Не частіше одного тосту «перезапусти» за цей час. */
const STALE_TOAST_GAP_MS = 4000;

/**
 * Піднімає сесію Supabase і вантажить дані.
 * Запускається після рехідрації, щоб локальні рецепти встигли зʼявитись
 * у сховищі й могли переїхати в акаунт.
 */
function useBackend() {
  const hydrated = useApp((s) => s.hydrated);
  const toast = useToast();

  useEffect(() => {
    if (!hydrated) return;
    let dispose: (() => void) | undefined;
    initSession()
      .then((fn) => {
        dispose = fn;
      })
      /*
       * initSession ловить усе сама, але це остання точка, де відхилений
       * проміс ще можна перехопити. Далі — лише «unhandled rejection» у
       * консолі й заставка, що не зникне ніколи.
       */
      .catch(() => useApp.getState().setAuthChecked(true));
    return () => dispose?.();
  }, [hydrated]);

  // Помилки запису показуємо ненавʼязливо, не блокуючи роботу.
  useEffect(() => {
    let staleShownAt = -Infinity;
    return onSyncError((message) => {
      /*
       * Замкнений запис старого коду падає пачкою: кінець готування списує
       * кожен продукт окремим запитом. Одне «перезапусти» на кілька секунд
       * досить — стос однакових тостів лише закрив би екран.
       */
      if (message === STALE_WRITE_MESSAGE) {
        if (Date.now() - staleShownAt < STALE_TOAST_GAP_MS) return;
        staleShownAt = Date.now();
      }
      toast(message, "⚠️");
    });
  }, [toast]);
}

/**
 * Тихо перезаписує підписку на сповіщення при кожному запуску.
 *
 * Адреса підписки з часом змінюється сама, і тоді сервер шле в нікуди. Chrome
 * попереджає про це подією, а Safari — ні: там про заміну не дізнається ніхто,
 * і єдиний спосіб полагодити — щоразу звіряти те, що є в браузері, з тим, що
 * записано в базі. Коштує це один запит і рятує від найпідступнішого стану:
 * телефон показує «сповіщення увімкнено», а їх уже місяць немає.
 */
function usePushRepair() {
  const accountId = useApp((s) => s.account?.id);

  useEffect(() => {
    if (!accountId) return;
    void syncPushSubscription(accountId);
  }, [accountId]);
}

/** Скільки чекати на /api/version: повільна мережа не має тримати запит висіти. */
const VERSION_FETCH_TIMEOUT_MS = 5000;

/*
 * Що і коли відповів сервер — у модулі, а не в стані: це факт про запуск
 * застосунку, а не про компонент. Інакше повторне монтування (HMR, строгий
 * режим) щоразу питало б наново й обходило паузу між перевірками.
 */
let serverSchema: unknown = null;
let versionCheckedAt: number | null = null;
let versionFailures = 0;
let versionCheckRunning = false;

/*
 * Кому сказати, що сервер новіший. Теж у модулі: відповідь приходить тому
 * монтуванню, яке зараз живе, а не тому, що запит почало. У строгому режимі
 * dev перше монтування запускає запит і одразу розмонтовується, друге бачить
 * «запит уже летить» і чекає, — і без спільного списку відповідь падала б у
 * мертве замикання, а банер не зʼявлявся б до наступного повернення на екран.
 */
const versionListeners = new Set<(schema: number) => void>();

/** Якщо сервер новіший — замкнути запис і сказати всім, хто слухає. */
function announceNewerSchema() {
  if (shouldPromptReload(serverSchema, CLIENT_SCHEMA, versionCheckedAt, Date.now()) !== true) return;
  const schema = readServerSchema(serverSchema);
  if (schema === null) return;
  markClientStale();
  versionListeners.forEach((fn) => fn(schema));
}

/** Одна перевірка, якщо вона зараз доречна; рішення — у shouldPromptReload. */
async function checkVersion() {
  if (!isSupabaseConfigured || versionCheckRunning || document.visibilityState === "hidden") return;
  const step = shouldPromptReload(serverSchema, CLIENT_SCHEMA, versionCheckedAt, Date.now(), versionFailures);
  if (step === true) return announceNewerSchema();
  if (step === false) return;
  // Без мережі запит лише впаде; позначку часу не ставимо, тож спитаємо, щойно мережа зʼявиться.
  if (navigator.onLine === false) return;

  versionCheckRunning = true;
  versionCheckedAt = Date.now();
  try {
    serverSchema = await fetchServerSchema();
    // Невдача відкладає повтор на секунди, а не на 10 хвилин — див. VERSION_RETRY_BASE_MS.
    versionFailures = readServerSchema(serverSchema) === null ? versionFailures + 1 : 0;
  } finally {
    versionCheckRunning = false;
  }
  announceNewerSchema();
}

/** Номер схеми з сервера як є; будь-який збій — null, без жодного шуму. */
async function fetchServerSchema(): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERSION_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch("/api/version", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return body && typeof body === "object" && "schema" in body ? body.schema : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Чи не лишився цей код старішим за базу — див. src/lib/schema-version.ts.
 *
 * Питаємо на старті, коли застосунок повертається на екран (visibilitychange,
 * а для сторінки з bfcache — pageshow), коли вікно знову у фокусі, коли
 * зʼявляється мережа — і ще раз на 15 секунд, поки сторінка видима. Останнє —
 * не запит, а лише звірка з паузою: без неї вікно на десктопі, що стоїть
 * поруч з іншими, чи планшет на готуванні з увімкненим wake lock не
 * дізнались би про деплой ніколи, бо «видимість» у них не міняється. І саме
 * воно повторює невдалий запит за секунди. Мережа йде не частіше, ніж раз на
 * 10 хвилин після відповіді; рішення — у shouldPromptReload, тут лише дроти.
 *
 * Без бази писати нікуди, і перевіряти нема що. Без мережі — теж: запит лише
 * впаде.
 *
 * Повертає номер новішої схеми сервера, коли час перезапуститись, або null.
 */
function useVersionGate(): number | null {
  const [newer, setNewer] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const check = () => void checkVersion();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    versionListeners.add(setNewer);
    check();
    const timer = setInterval(check, VERSION_RETRY_BASE_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", check);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    return () => {
      versionListeners.delete(setNewer);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
    };
  }, []);

  return newer;
}

function Boot({ children }: { children: React.ReactNode }) {
  useRehydrate();
  useServiceWorker();
  useTheme();
  useBackend();
  usePushRepair();
  useEffect(() => initInstallPrompt(), []);
  const newerSchema = useVersionGate();
  // Обгортка стоїть завжди, а банер зʼявляється в ній — див. UpdateGate.
  return <UpdateGate schema={newerSchema}>{children}</UpdateGate>;
}

/*
 * «Редагувати тип» звідусіль — один аркуш поверх усього (src/lib/type-editor.ts).
 * Лениво й без SSR: редактор типу з обʼєднанням та історією важкий, а
 * потрібен рідко — першому екрану його вага ні до чого.
 */
const TypeEditorHost = dynamic(() => import("./NewIngredientSheet").then((m) => m.TypeEditorHost), { ssr: false });

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <Boot>{children}</Boot>
      <TypeEditorHost />
    </ToastProvider>
  );
}
