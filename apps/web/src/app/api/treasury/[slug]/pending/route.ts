/**
 * `GET /api/treasury/<slug>/pending` — proposals awaiting guardian signatures,
 * from `safe_proposals` with live counts from the Transaction Service
 * (`getConfirmations`); when the service is down the last stored count is
 * returned with `source: "db"`.
 */
import { getDb } from "@/db/client";
import { entityBySlug, json, slugOk } from "@/lib/jobs/common";
import { authorizeMcp } from "@/lib/treasury/auth";
import { getTreasuryDeps } from "@/lib/treasury/deps";
import { listPendingProposals } from "@/lib/treasury/reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = authorizeMcp(req);
  if (denied) return denied;
  const { slug } = await ctx.params;
  if (!slugOk(slug)) return json(400, { reason: "bad_entity" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const entity = await entityBySlug(db, slug);
  if (!entity) return json(404, { reason: "not_found" });
  const pending = await listPendingProposals(db, getTreasuryDeps(), entity.id);
  return json(200, { entity: slug, count: pending.length, pending });
}
