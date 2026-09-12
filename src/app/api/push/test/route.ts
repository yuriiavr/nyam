import { admin, pushConfigured, sendPush } from "@/lib/push-server";

/**
 * Пробне сповіщення самому собі.
 *
 * Ланцюг пуша довгий — браузер, запис у базі, ключі VAPID, служба Google або
 * Apple, налаштування телефона, — і будь-яка ланка мовчить, коли не працює.
 * Це єдиний спосіб пройти його цілком і побачити результат на власні очі.
 *
 * Надсилає лише самому собі: право доводиться токеном сесії, а не спільним
 * секретом, як у вебхука. Тобто з цього маршруту не можна написати нікому
 * іншому, навіть знаючи адресу.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function userFromRequest(request: Request): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anon) return null;

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string };
    return user.id ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!pushConfigured) {
    return Response.json({ ok: false, reason: "пуш не налаштовано на сервері" }, { status: 503 });
  }

  const userId = await userFromRequest(request);
  if (!userId) return Response.json({ ok: false, reason: "не впізнали сесію" }, { status: 401 });

  // Скільки пристроїв узагалі знає база — це половина відповіді на питання
  // «чому не приходить».
  const { count } = await admin()
    .from("push_subscriptions")
    .select("endpoint", { count: "exact", head: true })
    .eq("user_id", userId);

  const { sent, pruned } = await sendPush([userId], {
    title: "Ням на звʼязку",
    body: "Якщо ти це бачиш — сповіщення працюють.",
    url: "/settings",
    tag: "test",
  });

  return Response.json({ ok: true, sent, pruned, devices: count ?? 0 });
}
