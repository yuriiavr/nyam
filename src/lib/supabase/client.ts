"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

/**
 * Чи налаштовано бекенд. Якщо ні — застосунок працює в локальному режимі
 * (localStorage + демо-спільнота), як і раніше.
 */
export const isSupabaseConfigured = Boolean(url && key);

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (typeof window === "undefined") return null;
  if (!cached) {
    cached = createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "nyam-auth",
      },
    });
  }
  return cached;
}

/** Людською мовою — щоб не показувати користувачу сирі коди Postgres. */
export function friendlyError(error: unknown): string {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error ?? "");

  const map: Array<[RegExp, string]> = [
    [/invalid login credentials/i, "Невірна пошта або пароль."],
    [/email not confirmed/i, "Пошту ще не підтверджено — перевір скриньку."],
    [/user already registered/i, "Такий акаунт уже існує. Спробуй увійти."],
    [/password should be at least/i, "Пароль має бути щонайменше 6 символів."],
    [/unable to validate email/i, "Схоже, адреса пошти введена з помилкою."],
    [/rate limit|too many requests/i, "Забагато спроб. Спробуй за хвилину."],
    [/duplicate key.*handle/i, "Такий нік уже зайнятий."],
    [/row-level security/i, "Недостатньо прав для цієї дії."],
    [/failed to fetch|networkerror/i, "Немає звʼязку з сервером."],
    [/relation .* does not exist/i, "У базі немає таблиць — виконай supabase/schema.sql."],
    [/provider is not enabled/i, "Вхід через Google не увімкнено в налаштуваннях Supabase."],
    [/redirect_uri_mismatch/i, "Адреса повернення не збігається з тією, що вказана в Google Cloud."],
  ];

  for (const [re, text] of map) if (re.test(message)) return text;
  return message || "Щось пішло не так.";
}
