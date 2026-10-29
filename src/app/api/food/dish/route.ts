import { parseDish, type AiFailure, type PantryChoice } from "@/lib/food-ai";
import { rateLimiter, userFromRequest } from "@/lib/server-auth";

/**
 * «Що зʼїв» словами → продукти з вагою й підходящі рядки комори.
 *
 * Комору шле застосунок, а не читає маршрут: вона вже в телефоні, а читати
 * її тут означало б ще один запит службовим ключем. Брехати про власну
 * комору нікому не вигідно — найгірше, людина отримає дивну підказку.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const admit = rateLimiter(60, 60 * 60_000);

const STATUS: Record<AiFailure, number> = { misconfigured: 503, upstream: 502, unreadable: 422 };

function fail(reason: string, status: number) {
  return Response.json({ ok: false, reason }, { status });
}

function pantryFrom(raw: unknown): PantryChoice[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 200)
    .map((row) => (row ?? {}) as Record<string, unknown>)
    .filter((row) => typeof row.id === "string" && typeof row.name === "string")
    .map((row) => ({
      id: String(row.id).slice(0, 80),
      name: String(row.name).slice(0, 120),
      ...(typeof row.type === "string" ? { type: row.type.slice(0, 60) } : {}),
      ...(typeof row.gramsPerPiece === "number" && row.gramsPerPiece > 0 ? { gramsPerPiece: row.gramsPerPiece } : {}),
    }));
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail("nokey", 503);

  const deadline = Date.now() + 25_000;
  const userId = await userFromRequest(request);
  if (!userId) return fail("unauthorized", 401);
  if (!admit(userId)) return fail("throttled", 429);

  let body: { text?: unknown; pantry?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("invalid", 400);
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < 2 || text.length > 600) return fail("invalid", 400);

  const res = await parseDish(text, pantryFrom(body.pantry), { key, deadline });
  if (!res.ok) {
    // Текст страви — не секрет, але й не потрібен у журналі: досить причини.
    console.warn(`[food/dish] → ${res.reason}: ${res.cause}`);
    return fail(res.reason, STATUS[res.reason]);
  }
  return Response.json({ ok: true, dish: res.value });
}
