import { bearer, handleMcp, noStream } from "@/lib/mcp/server";

/**
 * MCP для голосового помічника: ключ у заголовку `Authorization: Bearer …`
 * (Gemini CLI, більшість клієнтів). Див. src/lib/mcp/server.ts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const POST = (request: Request) => handleMcp(request, bearer(request));
export const GET = noStream;
export const DELETE = noStream;
