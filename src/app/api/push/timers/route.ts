import {
  admin,
  authorised,
  pushConfigured,
  sendPushToDevice,
  type PushFailure,
} from "@/lib/push-server";
import {
  pickDueTimers,
  TIMER_LEAD_MS,
  TIMER_PUSH_COLUMNS,
  TIMER_TTL_SEC,
  type TimerPushRow,
} from "@/lib/timer-push";

/**
 * Будильники готування, яким настав час.
 *
 * Кличе сама база: pg_cron раз на пʼять секунд перевіряє timer_pushes і,
 * лише коли там є що дзвонити, робить сюди запит (див. supabase/timer-push.sql).
 * Розклад Vercel тут не годиться — він не частіший за раз на хвилину, а
 * будильник, що запізнюється на хвилину, для макаронів уже вирок.
 *
 * Тіло запиту не читаємо зовсім: що і кому надіслати, вирішує таблиця.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  if (!authorised(request)) return new Response("Немає доступу", { status: 401 });
  if (!pushConfigured) return Response.json({ ok: false, reason: "не налаштовано" }, { status: 503 });

  const now = Date.now();

  /*
   * Забираємо рядки видаленням, а не читанням.
   *
   * Виклики можуть накластись: холодний старт маршруту буває довшим за крок
   * розкладу, і тоді база кличе вдруге, поки перший ще не відповів. Delete
   * з returning атомарний — кожен рядок дістається рівно одному виклику, тож
   * будильник не продзвонить двічі. Ціна — якщо надіслати не вдасться, вдруге
   * не спробуємо; але будильник, що приходить із запізненням на повтор, уже
   * не будильник.
   *
   * Колонки endpoint у базі ще немає (маршрут задеплоїли раніше, ніж
   * перезапустили timer-push.sql) — запит упаде цілком і рядків не зачепить:
   * краще 502 у журналі відповідей, ніж будильники, забрані й не надіслані.
   */
  const { data, error } = await admin()
    .from("timer_pushes")
    .delete()
    .lte("fire_at", new Date(now + TIMER_LEAD_MS).toISOString())
    .select(TIMER_PUSH_COLUMNS);

  if (error) return Response.json({ ok: false, reason: error.message }, { status: 502 });

  const rows = (data ?? []) as TimerPushRow[];
  const { due, stale } = pickDueTimers(rows, now);

  let sent = 0;
  let pruned = 0;
  const failed: PushFailure[] = [];
  const errors: string[] = [];

  await Promise.all(
    due.map(async (row) => {
      try {
        /*
         * Лише на пристрій, де запустили таймер (див. TimerPushRow.endpoint).
         * Запасного «тоді на всі пристрої» навмисно немає: рядок без адреси
         * чи з адресою, якої база вже не знає, — це саме той випадок, коли
         * будильник задзвонив би на ноутбуці, поки людина стоїть біля плити з
         * телефоном. Такий рядок іде у failed з reason «unknown-device», а
         * місцевий будильник на сторінці готування працює й без нього.
         */
        const result = await sendPushToDevice(
          row.user_id,
          row.endpoint,
          {
            title: row.title,
            body: row.body,
            url: row.url ?? "/",
            /*
             * Той самий тег, що й у місцевого будильника на сторінці
             * готування: коли встигли обидва, на екрані одне сповіщення, а не
             * два однакових.
             */
            tag: "nyam-timer",
            requireInteraction: true,
            vibrate: [200, 100, 200, 100, 300],
          },
          { ttl: TIMER_TTL_SEC },
        );
        sent += result.sent;
        // Мертва підписка (404/410) — теж будильник, що не дійшов; рахуємо окремо.
        pruned += result.pruned;
        failed.push(...result.failed);
        if (result.error) errors.push(result.error);
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : String(cause));
      }
    }),
  );

  return Response.json({
    ok: true,
    claimed: rows.length,
    sent,
    stale,
    pruned,
    failed,
    ...(errors.length ? { errors } : {}),
  });
}
