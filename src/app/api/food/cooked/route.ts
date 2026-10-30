import { cleanPer100 } from "@/lib/food-ai";
import { estimateCooked, type CookedLine, type EstimateFailure } from "@/lib/nutrition-ai";
import { rateLimiter, userFromRequest } from "@/lib/server-auth";
import type { RecipeStep } from "@/lib/types";

/**
 * «Що справді пішло в страву» → КБЖВ саме цього готування.
 *
 * Склад шле застосунок: це не рецепт із бази, а те, що людина розписала
 * після готування, — з пачками зі своєї комори й вагою готового там, де
 * зважувала готове. Брехати тут нікому не вигідно: найгірше — дивне число
 * у власному щоденнику.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const admit = rateLimiter(60, 60 * 60_000);

const STATUS: Record<EstimateFailure, number> = { misconfigured: 503, upstream: 502, unreadable: 422 };

function fail(reason: string, status: number) {
  return Response.json({ ok: false, reason }, { status });
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Рядки — без викидання: модель відповідає номерами рядків, і застосунок
 * зіставляє їх зі своїм списком. Викинутий посередині рядок зсунув би всі
 * наступні — бекон отримав би калорії яєць.
 */
function linesFrom(raw: unknown): CookedLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 80).map((x): CookedLine => {
    const line = (x ?? {}) as Record<string, unknown>;
    const name = text(line.name, 200).trim() || "невідомий продукт";
    const cooked = line.cooked === true;
    const label = cooked ? null : cleanPer100(line.label);
    return { name, qty: text(line.qty, 60), ...(cooked ? { cooked } : {}), ...(label ? { label } : {}) };
  });
}

function stepsFrom(raw: unknown): RecipeStep[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 60).flatMap((x): RecipeStep[] => {
    const step = (x ?? {}) as Record<string, unknown>;
    const t = text(step.text, 1200);
    if (!t.trim()) return [];
    const tip = text(step.tip, 400);
    return [{ text: t, ...(tip ? { tip } : {}) }];
  });
}

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail("nokey", 503);

  const deadline = Date.now() + 25_000;
  const userId = await userFromRequest(request);
  if (!userId) return fail("unauthorized", 401);
  if (!admit(userId)) return fail("throttled", 429);

  let body: { title?: unknown; description?: unknown; lines?: unknown; steps?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("invalid", 400);
  }
  const lines = linesFrom(body.lines);
  const title = text(body.title, 200).trim();
  if (!title || lines.length === 0) return fail("invalid", 400);

  const res = await estimateCooked(
    { title, description: text(body.description, 1200), lines, steps: stepsFrom(body.steps) },
    { key, deadline },
  );
  if (!res.ok) {
    console.warn(`[food/cooked] → ${res.reason}: ${res.cause.slice(0, 300)}`);
    return fail(res.reason, STATUS[res.reason]);
  }
  return Response.json({ ok: true, ...res.value });
}
