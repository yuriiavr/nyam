import { estimateProduct, readLabel, type AiFailure } from "@/lib/food-ai";
import { rateLimiter, userFromRequest } from "@/lib/server-auth";

/**
 * КБЖВ товару, коли етикетки в картці немає.
 *
 * Два способи, від точнішого: фото таблиці харчової цінності (модель
 * переписує надруковане) або оцінка за назвою, виробником і жирністю.
 * Маршрут лише відповідає — у картку число записує людина через save_product:
 * так правка лягає в історію з її іменем, а оцінка ШІ — з позначкою «ai».
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const admit = rateLimiter(40, 60 * 60_000);

/** Фото етикетки після стиснення — сотні кілобайт; три мегабайти base64 із запасом. */
const MAX_BASE64 = 3 * 1024 * 1024;

const STATUS: Record<AiFailure, number> = { misconfigured: 503, upstream: 502, unreadable: 422 };

function fail(reason: string, status: number) {
  return Response.json({ ok: false, reason }, { status });
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail("nokey", 503);

  const deadline = Date.now() + 25_000;
  const userId = await userFromRequest(request);
  if (!userId) return fail("unauthorized", 401);
  if (!admit(userId)) return fail("throttled", 429);

  let body: {
    image?: string;
    name?: string;
    brand?: string;
    type?: string;
    fatPct?: number;
    pack?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("invalid", 400);
  }

  if (typeof body.image === "string" && body.image) {
    const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(body.image);
    const mime = match ? match[1] : "image/jpeg";
    const data = match ? match[2] : body.image;
    if (data.length > MAX_BASE64) return fail("toobig", 413);
    const res = await readLabel({ mime, data }, { key, deadline });
    if (!res.ok) {
      console.warn(`[food/product] етикетка → ${res.reason}: ${res.cause}`);
      return fail(res.reason, STATUS[res.reason]);
    }
    return Response.json({ ok: true, from: "label", ...res.value });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2) return fail("invalid", 400);
  const res = await estimateProduct(
    {
      name,
      brand: typeof body.brand === "string" ? body.brand : undefined,
      type: typeof body.type === "string" ? body.type : undefined,
      fatPct: typeof body.fatPct === "number" && body.fatPct >= 0 && body.fatPct <= 100 ? body.fatPct : undefined,
      pack: typeof body.pack === "string" ? body.pack : undefined,
    },
    { key, deadline },
  );
  if (!res.ok) {
    console.warn(`[food/product] оцінка «${name}» → ${res.reason}: ${res.cause}`);
    return fail(res.reason, STATUS[res.reason]);
  }
  return Response.json({ ok: true, from: "ai", ...res.value });
}
