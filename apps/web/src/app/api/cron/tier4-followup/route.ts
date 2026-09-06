/**
 * `GET|POST /api/cron/tier4-followup` — daily. Tier-4 follow-ups whose
 * `follow_up_due` has passed get an evaluator notified and a
 * `tier4_followup_due` event. Nothing is evaluated and nothing is paid here.
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { runTier4FollowUps } from "@/lib/reports/tier4";
import { getTreasuryDeps } from "@/lib/treasury/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(req: Request): Promise<Response> {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const slug = new URL(req.url).searchParams.get("slug") ?? undefined;
  const started = Date.now();
  try {
    const result = await runTier4FollowUps(db, getTreasuryDeps(), slug ? { slug } : {});
    return json(200, { job: "tier4-followup", considered: result.considered, due: result.due.length, notified: result.notified, skipped: result.skipped, entries: result.due, took_ms: Date.now() - started });
  } catch (err) {
    console.error("[cron/tier4-followup]", err);
    return json(500, { job: "tier4-followup", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
