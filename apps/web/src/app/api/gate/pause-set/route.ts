/**
 * `GET /api/gate/pause-set` — the set the gate polls every 30 s
 * (`apps/gate/src/entity_gate/pause.py`; docs/verify.md #30). Shape:
 * `{"paused": [slug…], "as_of": "…"}`. Retired entities are in the set too.
 *
 * Auth: `X-Gate-Admin: $GATE_ADMIN_SECRET` or the same value as a bearer
 * (the gate sends `Authorization: Bearer $KAMI_PLATFORM_TOKEN`).
 */
import { getDb } from "@/db/client";
import { isAdminToken, isGateSecret, json } from "@/lib/jobs/common";
import { pauseSet } from "@/lib/jobs/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isGateSecret(req) && !isAdminToken(req)) return json(401, { reason: "unauthorized" });
  const db = getDb();
  // Fail closed is the gate's choice; with no DB we cannot answer, so say so.
  if (!db) return json(503, { reason: "no_database" });
  return json(200, await pauseSet(db));
}
