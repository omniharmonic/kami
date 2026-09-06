/**
 * `GET /api/treasury/<slug>/balance` — the Safe's USDC balance read from the
 * chain (viem `balanceOf`), cached 60 s. When the RPC is unreachable the
 * answer is `{"balance_usdc": null, "reason": …}`: absent is unknown, never
 * zero (CLAUDE.md). Bearer: the platform MCP token.
 */
import { getDb } from "@/db/client";
import { entityBySlug, json, slugOk } from "@/lib/jobs/common";
import { authorizeMcpFor } from "@/lib/treasury/auth";
import { getTreasuryDeps } from "@/lib/treasury/deps";
import { readSafeBalance } from "@/lib/treasury/reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await ctx.params;
  if (!slugOk(slug)) return json(400, { reason: "bad_entity" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const auth = await authorizeMcpFor(req, db, slug);
  if (auth instanceof Response) return auth;
  const entity = await entityBySlug(db, slug);
  if (!entity) return json(404, { reason: "not_found" });
  const balance = await readSafeBalance(getTreasuryDeps(), entity.safeAddress);
  return json(200, { entity: slug, ...balance }, { "cache-control": "no-store" });
}
