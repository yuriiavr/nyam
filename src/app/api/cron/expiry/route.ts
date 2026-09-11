import { ing } from "@/data/ingredients";
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
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PantryRow {
  user_id: string;
  ingredient_key: string;
  expires_at: string;
}

const dayKey = (shift: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + shift);
  return d.toISOString().slice(0, 10);
};

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) return new Response("Немає доступу", { status: 401 });
  if (!pushConfigured) return Response.json({ ok: false, reason: "не налаштовано" }, { status: 503 });

  const today = dayKey(0);
  const tomorrow = dayKey(1);

  const { data, error } = await admin()
    .from("pantry_items")
    .select("user_id,ingredient_key,expires_at")
    .gte("expires_at", today)
    .lte("expires_at", tomorrow);

  if (error) return Response.json({ ok: false, reason: error.message }, { status: 502 });

  const byUser = new Map<string, PantryRow[]>();
  for (const row of (data ?? []) as PantryRow[]) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  }

  let notified = 0;
  for (const [userId, rows] of byUser) {
    // Найтерміновіше — першим у тексті: саме його назву людина побачить.
    rows.sort((a, b) => a.expires_at.localeCompare(b.expires_at));

    const first = ing(rows[0].ingredient_key).label;
    const rest = rows.length - 1;
    const when = rows[0].expires_at === today ? "сьогодні останній день" : "псується завтра";

    const { sent } = await sendPush([userId], {
      title: rest > 0 ? `${first} — ${when}` : `${first}: ${when}`,
      body:
        rest > 0
          ? `І ще ${rest} ${rest === 1 ? "продукт" : rest < 5 ? "продукти" : "продуктів"} на черзі. Зазирни, що з них приготувати.`
          : "Зазирни в комору — можливо, саме з нього щось вийде.",
      url: "/decide/rescue",
      // Один тег на всі дні: вчорашнє нагадування заміниться, а не ляже поруч.
      tag: "expiry",
    });
    if (sent > 0) notified += 1;
  }

  return Response.json({ ok: true, users: byUser.size, notified });
}
