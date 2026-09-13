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
  /**
   * Для будильника: не ховати, доки не натиснуть, і вібрувати довше. Так
   * поводиться і місцевий будильник готування, тож сповіщення з сервера, яке
   * його заміняє, не має бути тихішим. Android це слухає, iOS ігнорує.
   */
  requireInteraction?: boolean;
  vibrate?: number[];
}

/**
 * Чому пристрій не отримав повідомлення.
 *
 * Лише хост, не адреса цілком: адреса підписки — це фактично ключ до
 * пристрою, і в журналі відповідей бази їй не місце. Хоста досить, щоб
 * відрізнити Apple від Google, а статус каже решту: 403 — підпис, 413 —
 * завелике тіло, null — до служби пуша не дійшли взагалі.
 */
export interface PushFailure {
  status: number | null;
  endpointHost: string;
  /**
   * «unknown-device» — до служби пуша навіть не йшли: база не знає такої
   * підписки в цього акаунта (пристрій відписався, адреса змінилась). Без
   * позначки це було б те саме null, що й «мережа впала».
   */
  reason?: "unknown-device";
}

/* Не PushResult: так уже зветься результат увімкнення на клієнті (lib/push.ts). */
export interface SendResult {
  sent: number;
  pruned: number;
  failed: PushFailure[];
  /** Не вдалося навіть прочитати підписки — тоді решта нулів нічого не означає. */
  error?: string;
}

/** Доба життя за замовчуванням — див. коментар у sendPush. */
const DEFAULT_TTL = 86_400;

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
  options: { ttl?: number } = {},
): Promise<SendResult> {
  if (!pushConfigured || userIds.length === 0) return { sent: 0, pruned: 0, failed: [] };

  const sb = admin();
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .in("user_id", userIds);

  if (error) return { sent: 0, pruned: 0, failed: [], error: error.message };
  if (!data?.length) return { sent: 0, pruned: 0, failed: [] };

  return deliver(sb, data as Row[], message, options.ttl ?? DEFAULT_TTL);
}

/**
 * Надсилає повідомлення на один пристрій людини — той, що названо адресою.
 *
 * Для будильника готування: дзвонити треба там, де запустили таймер, а не на
 * всіх пристроях акаунта. Підписку шукаємо за адресою І за власником разом:
 * адресу пише в рядок будильника сам клієнт, і без другої умови чужий
 * будильник міг би влучити в чужий телефон.
 *
 * Підписки немає — це збій, а не «нікому надсилати»: таймер ставився, коли
 * база її знала, тож людина чекає дзвінка.
 */
export async function sendPushToDevice(
  userId: string,
  endpoint: string | null,
  message: PushMessage,
  options: { ttl?: number } = {},
): Promise<SendResult> {
  if (!pushConfigured) return { sent: 0, pruned: 0, failed: [] };

  const unknown: SendResult = {
    sent: 0,
    pruned: 0,
    failed: [{ status: null, endpointHost: endpoint ? hostOf(endpoint) : "?", reason: "unknown-device" }],
  };
  if (!endpoint) return unknown;

  const sb = admin();
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("endpoint,p256dh,auth")
    .eq("user_id", userId)
    .eq("endpoint", endpoint)
    .limit(1);

  if (error) return { sent: 0, pruned: 0, failed: [], error: error.message };
  if (!data?.length) return unknown;

  return deliver(sb, data as Row[], message, options.ttl ?? DEFAULT_TTL);
}

async function deliver(
  sb: SupabaseClient,
  rows: Row[],
  message: PushMessage,
  ttl: number,
): Promise<SendResult> {
  /*
   * Адреса в підписі має бути справжньою. Служба пуша Apple перевіряє її і
   * відповідає 403 на вигадану — тобто з «mailto:nyam@example.com» усі
   * сповіщення на iPhone падали б, а виглядало б це як «нікому надсилати».
   */
  webpush.setVapidDetails("https://nyam-eight-plum.vercel.app", VAPID_PUBLIC, VAPID_PRIVATE);

  const payload = JSON.stringify(message);
  const dead: string[] = [];
  const failed: PushFailure[] = [];
  let sent = 0;

  await Promise.all(
    rows.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          payload,
          {
            /*
             * Високий пріоритет — щоб Android не притримав сповіщення до
             * ранку: у режимі сну він відкладає все, крім термінового.
             *
             * Доба життя: нагадування про строк придатності на післязавтра
             * нікому не потрібне, а лайк тим паче. Хто знає, що його
             * повідомлення старіє швидше (будильник), передає свій строк.
             */
            urgency: "high",
            TTL: ttl,
            // Тема склеює однакові поки телефон офлайн — так само, як тег
            // склеює їх уже на екрані.
            topic: message.tag ? message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : undefined,
          },
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(row.endpoint);
        else {
          /*
           * 403 — це відмова служби пуша, а не мертва підписка: найчастіше
           * підпис не зійшовся. Без цього рядка така помилка виглядала б у
           * точності як «ніхто не підписаний».
           */
          console.warn(`[push] ${status ?? "?"} для ${row.endpoint.slice(0, 60)}…`);
          /*
           * І те саме — у відповідь маршруту. Консоль Vercel видно не завжди,
           * а відповідь на виклик із бази лягає в net._http_response поруч із
           * самим викликом: минуле розслідування «чому не прийшло» було сліпим
           * саме через те, що там стояло лише «sent: 0».
           */
          failed.push({ status: status ?? null, endpointHost: hostOf(row.endpoint) });
        }
      }
    }),
  );

  if (dead.length) await sb.from("push_subscriptions").delete().in("endpoint", dead);
  return { sent, pruned: dead.length, failed };
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "?";
  }
}
