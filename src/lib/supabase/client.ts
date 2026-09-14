"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { guardStaleWrites } from "../schema-version";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

/**
 * Чи адреса — справжня http(s)-адреса, а не просто непорожній рядок.
 *
 * Саме це перевіряє createClient, і саме на цьому він кидає виняток. А
 * порожнім значення буває не лише тоді, коли його забули: Vercel не віддає
 * `vercel pull` значень, позначених sensitive, — замість них у файл їде рядок
 * `[SENSITIVE]`, і збірка вшиває його в бандл як справжню адресу. Так і
 * сталось: застосунок у проді назавжди лишався на заставці, бо createClient
 * падав ще до того, як хтось встигав спитати про сесію.
 *
 * Ключі з префіксом NEXT_PUBLIC_ позначати sensitive не можна за визначенням
 * (префікс означає «віддати у браузер»), але помилку в налаштуваннях має
 * ловити код, а не людина за крутілкою.
 */
function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Чи налаштовано бекенд. Якщо ні — застосунок працює в локальному режимі
 * (localStorage + демо-спільнота), як і раніше.
 */
export const isSupabaseConfigured = isHttpUrl(url) && Boolean(key);

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (typeof window === "undefined") return null;
  if (!cached) {
    cached = create(url!, key!);
  }
  return cached;
}

/**
 * Створює клієнт і НЕ кидає: єдиний виняток звідси зупиняв увесь запуск.
 * Не вийшло — застосунок піде далі без бекенду й скаже про це словами.
 */
function create(url: string, key: string): SupabaseClient | null {
  try {
    return createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "nyam-auth",
      },
      /*
       * Єдині двері, через які застосунок пише в базу. Коли перевірка версії
       * дізналась, що сервер новіший, запис тут і зупиняється — хоч би звідки
       * він ішов: з готування, сканера чи аркуша під банером
       * (див. src/lib/schema-version.ts).
       */
      global: { fetch: guardStaleWrites },
    });
  } catch (error) {
    console.error("[supabase] клієнта не вдалося створити", error);
    return null;
  }
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
    // Запобіжник дерева типів (supabase/ingredient-parents.sql).
    [/задовгий ланцюжок різновидів/i, "Забагато рівнів різновидів — обери загальніший тип."],
    [/не може бути різновидом самого себе/i, "Тип не може бути різновидом самого себе."],
    [/немає типу/i, "Такого типу вже немає — онови застосунок і обери тип ще раз."],
  ];

  for (const [re, text] of map) if (re.test(message)) return text;
  return message || "Щось пішло не так.";
}
