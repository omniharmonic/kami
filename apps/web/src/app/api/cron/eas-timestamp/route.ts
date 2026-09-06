/**
 * `GET|POST /api/cron/eas-timestamp` — nightly: Merkle-root every offchain
 * attestation not yet timestamped and write them in one `multiTimestamp`
 * (ADR-E06, §8.2; *verify* docs/verify.md #9).
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { getTreasuryDeps } from "@/lib/treasury/deps";
import { runEasTimestamp } from "@/lib/treasury/eas-timestamp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  try {
    const out = await runEasTimestamp(db, getTreasuryDeps());
    return json(200, { job: "eas-timestamp", ...out });
  } catch (err) {
    console.error("[cron/eas-timestamp]", err);
    return json(500, { job: "eas-timestamp", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
