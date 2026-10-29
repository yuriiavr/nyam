import { bearer, handleMcp, noStream } from "@/lib/mcp/server";

/**
 * Той самий MCP, але ключ — частина адреси: для клієнтів, де заголовків не
 * задати (власний конектор Claude). Заголовок, якщо він є, важить більше.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return handleMcp(request, bearer(request) ?? decodeURIComponent(key));
}

export const GET = noStream;
export const DELETE = noStream;
