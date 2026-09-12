import { admin, pushConfigured } from "@/lib/push-server";

/**
 * Підписка змінила адресу.
 *
 * Браузери час від часу видають підписці нову адресу — і стара просто
 * перестає працювати. Chrome попереджає про це подією `pushsubscriptionchange`
 * у service worker; звідти нікуди, крім мережі, не звернешся: сесії
 * користувача там немає, ключів теж.
 *
 * Тому правом тут є володіння старою адресою: хто її знає, той і був цією
 * підпискою. Нічого чужого таким запитом не зачепиш — рядок оновлюється лише
 * той, що збігся адресою, а власник у ньому лишається колишній.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!pushConfigured) return Response.json({ ok: false }, { status: 503 });

  let body: { old?: string; endpoint?: string; p256dh?: string; auth?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, reason: "не розібрали запит" }, { status: 400 });
  }

  const { old, endpoint, p256dh, auth } = body;
  if (!old || !endpoint || !p256dh || !auth) {
    return Response.json({ ok: false, reason: "бракує полів" }, { status: 400 });
  }

  const sb = admin();
  const { data: row } = await sb
    .from("push_subscriptions")
    .select("user_id,agent")
    .eq("endpoint", old)
    .maybeSingle();

  // Старої адреси немає — значить, і поновлювати нічого: або її вже прибрали
  // як мертву, або запит прийшов не від нас.
  if (!row) return Response.json({ ok: false, reason: "невідома підписка" }, { status: 404 });

  const previous = row as { user_id: string; agent: string | null };
  const { error } = await sb.from("push_subscriptions").upsert(
    {
      endpoint,
      user_id: previous.user_id,
      p256dh,
      auth,
      agent: previous.agent,
    },
    { onConflict: "endpoint" },
  );
  if (error) return Response.json({ ok: false, reason: error.message }, { status: 500 });

  await sb.from("push_subscriptions").delete().eq("endpoint", old);
  return Response.json({ ok: true });
}
