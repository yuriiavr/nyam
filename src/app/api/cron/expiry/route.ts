import { expiryMessage, expiryRowName, type ExpiryRow } from "@/lib/expiry-text";
import { admin, authorised, pushConfigured, sendPush } from "@/lib/push-server";

/**
 * Щоденна перевірка строків придатності.
 *
 * Викликається розкладом Vercel раз на добу (див. vercel.json) і надсилає
 * кожному, у кого щось псується сьогодні або завтра, одне сповіщення. Саме
 * одне: п'ять окремих про п'ять продуктів — це не турбота, а набридання.
 *
 * Прострочене сюди не потрапляє навмисно. Порада зʼїсти те, що зіпсувалось
 * учора, гірша за мовчання, а списком «викинь» ніхто не зрадіє щоранку.
 *
 * Кому. Лише власнику рядка (user_id) — навіть у сімʼї (H2.5): кожна пачка
 * має того, хто її приніс, і два однакові сповіщення двом людям про ту саму
 * пачку були б шумом. Сімейна комора однаково видна обом у застосунку.
 *
 * Назва. Сервер не має реєстру дописаних типів і кешу карток, тож дотягуємо
 * їх тут: назви карток товарів (I4) і назви own_* типів. Касовий рядок людям
 * не показуємо — з нього складається людська назва (expiryRowName).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PantryRow extends ExpiryRow {
  user_id: string;
}

const dayKey = (shift: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
};

const uniq = <T,>(list: Iterable<T>): T[] => [...new Set(list)];

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) return new Response("Немає доступу", { status: 401 });
  if (!pushConfigured) return Response.json({ ok: false, reason: "не налаштовано" }, { status: 503 });

  const today = dayKey(0);
  const tomorrow = dayKey(1);

  const { data, error } = await admin()
    .from("pantry_items")
    .select("user_id,ingredient_key,label,receipt_name,product_id,expires_at")
    .gte("expires_at", today)
    .lte("expires_at", tomorrow);

  if (error) return Response.json({ ok: false, reason: error.message }, { status: 502 });
  const rows = (data ?? []) as PantryRow[];

  /*
   * Довідники назв. Зовнішнього ключа на product_id немає навмисно (як у
   * shopping_items.recipe_id), тож і вбудованого join — окремий запит. Збій
   * довідника не скасовує сповіщення: назва типу краща за тишу.
   */
  const productIds = uniq(rows.flatMap((r) => (r.product_id ? [r.product_id] : [])));
  const ownKeys = uniq(rows.map((r) => r.ingredient_key).filter((key) => key.startsWith("own_")));
  const [productsRes, customRes] = await Promise.all([
    productIds.length
      ? admin().from("products").select("id,name").in("id", productIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    ownKeys.length
      ? admin().from("custom_ingredients").select("key,label").in("key", ownKeys)
      : Promise.resolve({ data: [] as Array<{ key: string; label: string }>, error: null }),
  ]);
  if (productsRes.error) console.warn("[cron/expiry] назви товарів не прочитались", productsRes.error.message);
  if (customRes.error) console.warn("[cron/expiry] дописані типи не прочитались", customRes.error.message);
  const lookups = {
    products: new Map(((productsRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name])),
    customLabels: new Map(((customRes.data ?? []) as Array<{ key: string; label: string }>).map((c) => [c.key, c.label])),
  };

  const byUser = new Map<string, PantryRow[]>();
  for (const row of rows) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  }

  let notified = 0;
  for (const [userId, own] of byUser) {
    // Найтерміновіше — першим у тексті: саме його назву людина побачить.
    const { title, body } = expiryMessage(
      own.map((row) => ({ expires_at: row.expires_at, name: expiryRowName(row, lookups) })),
      today,
    );
    if (!title) continue;

    const { sent } = await sendPush([userId], {
      title,
      body,
      url: "/decide/rescue",
      // Один тег на всі дні: вчорашнє нагадування заміниться, а не ляже поруч.
      tag: "expiry",
    });
    if (sent > 0) notified += 1;
  }

  return Response.json({ ok: true, users: byUser.size, notified });
}
