"use client";

import { useEffect } from "react";
import { ToastProvider, useToast } from "./ui";
import { useApp } from "@/lib/store";
import { initSession } from "@/lib/session";
import { onSyncError } from "@/lib/sync";
import { initInstallPrompt } from "@/lib/pwa";
import { syncPushSubscription } from "@/lib/push";

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
  }, []);
}

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
    initSession().then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
  }, [hydrated]);

  // Помилки запису показуємо ненавʼязливо, не блокуючи роботу.
  useEffect(() => onSyncError((message) => toast(message, "⚠️")), [toast]);
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

function Boot({ children }: { children: React.ReactNode }) {
  useRehydrate();
  useServiceWorker();
  useTheme();
  useBackend();
  usePushRepair();
  useEffect(() => initInstallPrompt(), []);
  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <Boot>{children}</Boot>
    </ToastProvider>
  );
}
