/**
 * `GET|POST /api/cron/retention` — nightly data retention (architecture §11,
 * plan X.7): chat messages older than 90 days deleted unless the session
 * opted in; usage events older than 90 days aggregated into daily rows.
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { runRetention } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  try {
    const report = await runRetention(db);
    return json(200, { job: "retention", ...report });
  } catch (err) {
    console.error("[cron/retention]", err);
    return json(500, { job: "retention", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
