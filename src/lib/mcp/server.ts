import "server-only";

import { rateLimiter } from "@/lib/server-auth";
import { mcpConfigured, userFromToken } from "./db";
import { TOOLS, TOOL_MAP, type Ctx } from "./tools";

/**
 * MCP-сервер Ням: Streamable HTTP без сесій, відповіді — звичайним JSON.
 *
 * Без станів і без SSE: кожен виклик самодостатній, тож сервер живе у
 * звичайному маршруті Vercel. Цього досить і Gemini, і Claude — обидва
 * говорять тим самим JSON-RPC: initialize → tools/list → tools/call.
 *
 * Ключ приходить заголовком `Authorization: Bearer nyam_…` або частиною
 * адреси (/api/mcp/nyam_…) — для клієнтів, де заголовків не задати.
 */

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST = SUPPORTED[0];

const INSTRUCTIONS = `Ням — кулінарний застосунок людини: щоденник харчування, комора (холодильник) і список покупок.
- «Я зʼїв батончик Корона» / «випив кефір Галичина»: search_products, потім log_product з product_id.
- Страва без конкретного товару («запечена картопля з сосисками»): log_dish з описом.
- «Додай у комору молоко безлактозне Галичина»: search_products, потім add_to_pantry; не знайшлось — add_to_pantry з name.
- «Купити хліб»: add_to_shopping.
- «Скільки я сьогодні зʼїв?»: get_diary. Помилковий запис прибирає delete_food_entry — списане ним повертається в комору.
- log_product сам списує товар із комори, якщо він там є. Людина каже, що купила не вдома, — from_pantry: false.
- log_dish комору сам не списує. Якщо у відповіді є сторінка підтвердження (open_url) і ти вмієш відкривати сторінки
  на екрані людини — відкрий її: там людина обирає, що саме взяли з комори. Не вмієш — скажи, що підтвердити можна
  в Ням → Щоденник. Посилань уголос не читай.
Відповідай людині коротко українською, як переказ результату інструмента.`;

/* Заслін від зацикленого клієнта: звичайна людина стільки не наговорить. */
const admit = rateLimiter(240, 60 * 60_000);

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

type RpcReply = { jsonrpc: "2.0"; id: string | number | null } & (
  | { result: unknown }
  | { error: { code: number; message: string } }
);

const ok = (id: RpcRequest["id"], result: unknown): RpcReply => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: RpcRequest["id"], code: number, message: string): RpcReply => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

async function dispatch(msg: RpcRequest, ctx: Ctx): Promise<RpcReply | null> {
  const isNotification = msg.id === undefined;
  const method = msg.method ?? "";

  if (isNotification || method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize": {
      const asked = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : LATEST;
      return ok(msg.id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "nyam", title: "Ням", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, {
        tools: TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
          name,
          title,
          description,
          inputSchema,
          ...(annotations ? { annotations } : {}),
        })),
      });
    case "tools/call": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      const tool = TOOL_MAP.get(name);
      if (!tool) return err(msg.id, -32602, `Невідомий інструмент: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (typeof args !== "object" || Array.isArray(args)) return err(msg.id, -32602, "arguments мають бути обʼєктом");
      if (!admit(ctx.userId)) {
        return ok(msg.id, {
          content: [{ type: "text", text: "Забагато запитів поспіль — спробуй за кілька хвилин." }],
          isError: true,
        });
      }
      try {
        return ok(msg.id, await tool.run(args, ctx));
      } catch (error) {
        console.warn(`[mcp] ${name} упав`, error);
        return ok(msg.id, { content: [{ type: "text", text: "Щось пішло не так — спробуй ще раз." }], isError: true });
      }
    }
    // Ресурсів і підказок немає, але клієнти іноді питають — порожні списки чесніші за помилку.
    case "resources/list":
      return ok(msg.id, { resources: [] });
    case "prompts/list":
      return ok(msg.id, { prompts: [] });
    default:
      return err(msg.id, -32601, `Метод не підтримується: ${method}`);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

export async function handleMcp(request: Request, token: string | null): Promise<Response> {
  if (!mcpConfigured()) return json(err(null, -32603, "Сервер Ням не налаштований для помічника"), 503);

  const userId = await userFromToken(token);
  if (!userId) {
    return json(err(null, -32001, "Ключ не підходить: створи новий у Ням → Налаштування → Голосовий помічник"), 401);
  }

  /*
   * Звідки клієнт прийшов — та сама адреса й для посилань, які помічник
   * відкриває людині. NYAM_PUBLIC_URL — якщо застосунок живе за проксі.
   */
  const origin = (process.env.NYAM_PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, "");
  const ctx: Ctx = { userId, origin };

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(err(null, -32700, "Не JSON"), 400);
  }

  // Старші клієнти шлють пачки — відповідаємо пачкою.
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.slice(0, 20).map((m) => dispatch(m as RpcRequest, ctx)))).filter(
      (r): r is RpcReply => r != null,
    );
    return replies.length ? json(replies) : new Response(null, { status: 202 });
  }
  if (!body || typeof body !== "object") return json(err(null, -32600, "Порожній запит"), 400);

  const reply = await dispatch(body as RpcRequest, ctx);
  return reply ? json(reply) : new Response(null, { status: 202 });
}

/** GET — потік подій сервера; його немає, і стандарт каже відповідати 405. */
export function noStream(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export function bearer(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() || null;
}
