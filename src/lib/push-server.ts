import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

/**
 * Розсилання пуш-сповіщень.
 *
 * Живе тільки на сервері: тут і приватний ключ VAPID, і службовий ключ бази.
 * Службовий потрібен тому, що надсилати треба ЧУЖИМ людям — RLS навмисно не
 * дає одному користувачеві прочитати підписки іншого, і це правильно.
 *
 * Тому все, що сюди звертається, спершу доводить право заголовком: маршрути
 * пуша відкриті в інтернет, і без цього будь-хто розсилав би сповіщення від
 * імені застосунку.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Куди вести після натиску. */
  url?: string;
  /** Сповіщення з однаковим тегом заміняють одне одного, а не копичаться. */
  tag?: string;
}

const PUSH_SECRET = process.env.PUSH_SECRET ?? "";
/* Розклад Vercel ходить зі своїм секретом і змінити заголовок не дає. */
const CRON_SECRET = process.env.CRON_SECRET ?? "";
/*
 * Публічний ключ приймаємо під обома назвами. У браузер Next віддає лише
 * змінні з префіксом NEXT_PUBLIC_, тож там альтернативи немає, а на сервері
 * читається будь-яка — щоб розсилка не мовчала через одну літеру в назві.
 */
const VAPID_PUBLIC =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Чи налаштовано все потрібне. Без цього маршрути мовчки нічого не роблять. */
export const pushConfigured = Boolean(
  (PUSH_SECRET || CRON_SECRET) && VAPID_PUBLIC && VAPID_PRIVATE && SUPABASE_URL && SERVICE_KEY,
);

/**
 * Чи має той, хто прийшов, право розсилати.
 *
 * Порівнюємо повністю, а не «починається з»: заголовок приходить ззовні, і
 * піддавати секрет посимвольному вгадуванню не варто.
 */
export function authorised(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const allowed = [PUSH_SECRET, CRON_SECRET].filter(Boolean);
  return allowed.some((secret) => header === `Bearer ${secret}`);
}

export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface Row {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Надсилає повідомлення на всі пристрої перелічених людей.
 *
 * Мертві підписки одразу прибираємо: браузер відповідає 404 або 410, коли
 * застосунок видалили чи дозвіл відкликали, і тримати такий рядок вічно
 * означає щодня стукати в нікуди.
 */
export async function sendPush(
  userIds: string[],
  message: PushMessage,
): Promise<{ sent: number; pruned: number }> {
  if (!pushConfigured || userIds.length === 0) return { sent: 0, pruned: 0 };

  webpush.setVapidDetails("mailto:nyam@example.com", VAPID_PUBLIC, VAPID_PRIVATE);

  const sb = admin();
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .in("user_id", userIds);

  if (error || !data?.length) return { sent: 0, pruned: 0 };

  const payload = JSON.stringify(message);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    (data as Row[]).map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(row.endpoint);
      }
    }),
  );

  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);
  return { sent, pruned: dead.length };
}
