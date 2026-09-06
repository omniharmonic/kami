/**
 * `GET /api/entities/[slug]/precheck` — the pulse precheck the box calls
 * before waking the model (architecture §5.3, A.2; the contract
 * `profiles/templates/skills/entity-steward/scripts/pulse_precheck.py`
 * expects: `{changed, snapshot_id}` with a bearer, and a 200 that always
 * parses).
 *
 * Auth: the entity's own `PLATFORM_MCP_TOKEN`, or `PLATFORM_ADMIN_TOKEN`.
 */
import { getDb } from "@/db/client";
import { isAdminToken, bearerFrom, entityBySlug, json, slugOk } from "@/lib/jobs/common";
import { verifyEntityToken } from "@/lib/mcp/tokens";
import { precheck } from "@/lib/jobs/precheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slugOk(slug)) return json(400, { reason: "bad_slug" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });

  const verified = await verifyEntityToken(db, bearerFrom(req));
  const admin = isAdminToken(req);
  if (!admin && (!verified || verified.slug !== slug)) {
    return json(401, { reason: "unauthorized" }, { "www-authenticate": 'Bearer realm="kami-precheck"' });
  }

  const entity = await entityBySlug(db, slug);
  if (!entity) return json(404, { reason: "not_found" });
  // A paused or retired entity never wakes (ADR-E12): the gate would refuse anyway.
  if (entity.pausedAt || entity.retiredAt) {
    return json(200, { changed: false, snapshot_id: null, snapshot_hash: null, as_of: null, reason: entity.retiredAt ? "retired" : "paused" });
  }
  const result = await precheck(db, entity.id);
  return json(200, result);
}
