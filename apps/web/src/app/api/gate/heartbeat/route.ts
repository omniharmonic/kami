/**
 * `POST /api/gate/heartbeat` — the GPU box says it is alive and hands over
 * the gate's JSONL rows.
 *
 *   { at?, host?, gate_version?, usage_events: [...], guard_events: [...] }
 *
 * Sets `config.gpu_last_seen_at` (the needs job's `gpu_online`, 10-minute
 * window) and inserts the rows into `usage_events` / `guard_events`.
 * Auth: `X-Gate-Admin`/bearer `GATE_ADMIN_SECRET`.
 */
import { getDb } from "@/db/client";
import { isAdminToken, isGateSecret, json } from "@/lib/jobs/common";
import { heartbeatSchema, recordHeartbeat } from "@/lib/jobs/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isGateSecret(req) && !isAdminToken(req)) return json(401, { reason: "unauthorized" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = heartbeatSchema.safeParse(raw ?? {});
  if (!parsed.success) return json(400, { reason: "bad_request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  try {
    return json(200, await recordHeartbeat(db, parsed.data));
  } catch (err) {
    console.error("[gate/heartbeat]", err);
    return json(500, { reason: (err as Error).message });
  }
}
