import { admin, authorised, pushConfigured, sendPush } from "@/lib/push-server";

/**
 * Пуш про подію в застосунку: коментар, лайк, збереження, приготування.
 *
 * Викликає сама база через вебхук на вставку в notifications — і саме тому
 * маршрут не довіряє тілу запиту на слово: він бере з нього лише
 * ідентифікатор рядка, а все інше перечитує з бази службовим ключем.
 * Інакше будь-хто, хто вгадав секрет, надсилав би тексти від чужого імені.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Що написати про кожен тип події. Текст коротка — це рядок на екрані. */
const WORDING: Record<string, string> = {
  comment: "залишив коментар до твого рецепта",
  like: "вподобав твій рецепт",
  save: "зберіг твій рецепт",
  cook: "приготував твою страву",
  rating: "оцінив твій рецепт",
  follow: "підписався на тебе",
  family_join: "приєднався до твоєї сімʼї",
};

export async function POST(request: Request): Promise<Response> {
  if (!authorised(request)) return new Response("Немає доступу", { status: 401 });
  if (!pushConfigured) return Response.json({ ok: false, reason: "не налаштовано" }, { status: 503 });

  let id: string | undefined;
  try {
    const payload = (await request.json()) as { record?: { id?: string } };
    id = payload.record?.id;
  } catch {
    id = undefined;
  }
  if (!id) return Response.json({ ok: false, reason: "немає запису" }, { status: 400 });

  const sb = admin();
  const { data: row } = await sb
    .from("notifications")
    .select("user_id,actor_id,type,recipe_id")
    .eq("id", id)
    .maybeSingle();

  if (!row) return Response.json({ ok: false, reason: "не знайдено" }, { status: 404 });

  const event = row as { user_id: string; actor_id: string | null; type: string; recipe_id: string | null };
  const wording = WORDING[event.type];
  if (!wording) return Response.json({ ok: true, skipped: event.type });

  const [{ data: actor }, { data: recipe }] = await Promise.all([
    event.actor_id
      ? sb.from("profiles").select("name").eq("id", event.actor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    event.recipe_id
      ? sb.from("recipes").select("title").eq("id", event.recipe_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const who = (actor as { name?: string } | null)?.name ?? "Хтось";
  const dish = (recipe as { title?: string } | null)?.title;

  const { sent } = await sendPush([event.user_id], {
    title: `${who} ${wording}`,
    body: dish ?? "",
    url: event.recipe_id ? `/recipe/${event.recipe_id}` : "/notifications",
    // Тег на подію і страву: десять лайків одного рецепта — одне сповіщення.
    tag: `${event.type}:${event.recipe_id ?? "app"}`,
  });

  return Response.json({ ok: true, sent });
}
