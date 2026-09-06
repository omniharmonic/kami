/**
 * `/api/mcp` — the platform MCP over Streamable HTTP, stateless, one
 * per-entity bearer token per profile (architecture §6.2; the profile
 * template points `mcp_servers.platform.url` at `{{platform_url}}/mcp`, which
 * `src/proxy.ts` rewrites here).
 */
import { handleMcpRequest } from "@/lib/mcp/server";
import { json } from "@/lib/jobs/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return handleMcpRequest(req);
}

export async function GET(req: Request) {
  return handleMcpRequest(req);
}

export async function DELETE() {
  // Stateless: there is no session to end.
  return json(405, { jsonrpc: "2.0", error: { code: -32000, message: "stateless server: no session to delete" }, id: null });
}
