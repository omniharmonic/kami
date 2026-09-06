/**
 * `GET /api/entities/[slug]/state` — the treasury MCP's pause check
 * (`packages/treasury-mcp/src/treasury_mcp/client.py:84`): it refuses to
 * propose a payout while the entity is paused (ADR-E12).
 */
import { getDb } from "@/db/client";
import { bearerFrom, entityBySlug, gpuOnline, isAdminToken, json, slugOk } from "@/lib/jobs/common";
import { verifyEntityToken } from "@/lib/mcp/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugOk(slug)) return json(400, { reason: "bad_slug" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });

  const verified = await verifyEntityToken(db, bearerFrom(req));
  if (!isAdminToken(req) && (!verified || verified.slug !== slug)) {
    return json(401, { reason: "unauthorized" }, { "www-authenticate": 'Bearer realm="kami-state"' });
  }
  const entity = await entityBySlug(db, slug);
  if (!entity) return json(404, { reason: "not_found" });
  const now = new Date();
  return json(200, {
    slug: entity.slug,
    entity_id: entity.id,
    paused: entity.pausedAt !== null,
    retired: entity.retiredAt !== null,
    gpu_online: await gpuOnline(db, now),
    as_of: now.toISOString(),
  });
}
