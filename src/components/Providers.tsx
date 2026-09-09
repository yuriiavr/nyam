"use client";

import { useEffect } from "react";
import { ToastProvider, useToast } from "./ui";
import { useApp } from "@/lib/store";
import { initSession } from "@/lib/session";
import { onSyncError } from "@/lib/sync";
import { initInstallPrompt } from "@/lib/pwa";

/** Реєстрація service worker — тільки в проді, щоб не ламати HMR. */
function useServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* офлайн-режим просто не увімкнеться */
      });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
}

/** Синхронізує вибрану тему з атрибутом на <html>. */
function useTheme() {
  const theme = useApp((s) => s.theme);
  const hydrated = useApp((s) => s.hydrated);
  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme === "light" ? "#fff8f3" : "#0d0a09");
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

function Boot({ children }: { children: React.ReactNode }) {
  useRehydrate();
  useServiceWorker();
  useTheme();
  useBackend();
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
