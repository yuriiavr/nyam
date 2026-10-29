import { recomputeRecipeNutrition, type RecomputeOutcome } from "@/lib/nutrition-ai";
import { admin, authorised } from "@/lib/push-server";

/**
 * Калорії рецепта від ШІ.
 *
 * Кличе сама база (supabase/recipe-nutrition.sql): тригер — щойно змінився
 * склад рецепта, і розклад раз на годину — добрати те, що не вдалось. Тому
 * маршрут закритий тим самим секретом, що й розсилка пушів, і з тіла бере
 * лише id: рецепт перечитує сам, службовим ключем.
 *
 * Відповідь пишемо докладну — база складає її в net._http_response, і
 * «чому в цього рецепта немає калорій» видно одним select, без журналів Vercel.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ліміт на автора: кожна правка складу — виклик моделі. Лічильник у памʼяті
 * інстанса, тож це заслін від зацикленого клієнта, а не від рішучого
 * зловмисника (справжня стеля — на ключі в Google). Відбитий рецепт нічого не
 * втрачає: лишається оцінка довідника, а за годину його добере розклад.
 */
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60_000;
const hits = new Map<string, number[]>();

function admit(authorId: string): boolean {
  const now = Date.now();
  if (hits.size > 5_000) hits.clear();
  const recent = (hits.get(authorId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.set(authorId, recent);
  if (recent.length >= RATE_LIMIT) return false;
  recent.push(now);
  return true;
}

/** HTTP-статус для журналу бази: 200 — усе гаразд, решта — чому ні. */
function statusOf(outcome: RecomputeOutcome): number {
  switch (outcome.status) {
    case "saved":
    case "fresh":
    case "stale":
      return 200;
    case "missing":
      return 404;
    case "throttled":
      return 429;
    case "failed":
      return outcome.reason === "misconfigured"
        ? 503
        : outcome.reason === "unreadable"
          ? 422
          : outcome.reason === "database"
            ? 500
            : 502;
  }
}

/** Скільки рецептів добір бере за раз: більше за хвилину однаково не встигнути. */
const SWEEP_CANDIDATES = 200;

export async function POST(request: Request): Promise<Response> {
  if (!authorised(request)) return new Response("Немає доступу", { status: 401 });

  const key = process.env.GEMINI_API_KEY;
  if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[recipe-nutrition] немає GEMINI_API_KEY чи SUPABASE_SERVICE_ROLE_KEY");
    return Response.json({ ok: false, reason: "не налаштовано" }, { status: 503 });
  }

  let body: { id?: unknown; sweep?: unknown };
  try {
    body = ((await request.json()) as typeof body | null) ?? {};
  } catch {
    body = {};
  }

  // Запас до 60 секунд платформи: відповідь має встигнути повернутись у базу.
  const deadline = Date.now() + 50_000;
  const sb = admin();

  if (typeof body.id === "string") {
    const outcome = await recomputeRecipeNutrition(sb, body.id, { key, deadline, admit });
    if (outcome.status === "failed") {
      console.error(`[recipe-nutrition] ${body.id} → ${outcome.reason}: ${outcome.cause}`);
    }
    return Response.json(
      { ok: outcome.status !== "failed", ...summary(outcome) },
      { status: statusOf(outcome) },
    );
  }

  if (body.sweep !== true) return Response.json({ ok: false, reason: "немає id" }, { status: 400 });

  /*
   * Добір. Молодші за дві хвилини не чіпаємо — їх ще рахує власний запит.
   * Порядок випадковий: рецепт, який не рахується ніколи (скажімо, порожній),
   * не стоятиме першим щоразу й не загородить решти.
   */
  const { data, error } = await sb
    .from("recipes")
    .select("id")
    .is("ai_nutrition", null)
    .lt("updated_at", new Date(Date.now() - 2 * 60_000).toISOString())
    .limit(SWEEP_CANDIDATES);
  if (error) return Response.json({ ok: false, reason: error.message }, { status: 500 });

  const ids = (data ?? []).map((row) => (row as { id: string }).id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  const tally: Record<string, number> = {};
  const failures: string[] = [];
  for (const id of ids) {
    // Один рецепт рідко довше за 10 секунд; почати і не встигнути — гірше, ніж не почати.
    if (deadline - Date.now() < 15_000) break;
    const outcome = await recomputeRecipeNutrition(sb, id, { key, deadline });
    tally[outcome.status] = (tally[outcome.status] ?? 0) + 1;
    if (outcome.status === "failed") {
      failures.push(`${id}: ${outcome.reason}: ${outcome.cause.slice(0, 120)}`);
      // Ключ чи квота: наступні впадуть так само.
      if (outcome.reason === "misconfigured") break;
    }
  }
  if (failures.length) console.error(`[recipe-nutrition] добір:\n${failures.join("\n")}`);

  return Response.json({ ok: true, candidates: ids.length, ...tally, failures: failures.slice(0, 5) });
}

function summary(outcome: RecomputeOutcome) {
  switch (outcome.status) {
    case "saved":
      return { status: outcome.status, kcal: outcome.nutrition.kcal, usage: outcome.usage };
    case "failed":
      return { status: outcome.status, reason: outcome.reason, cause: outcome.cause.slice(0, 300) };
    default:
      return { status: outcome.status };
  }
}
