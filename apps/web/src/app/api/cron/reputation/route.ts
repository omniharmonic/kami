/**
 * `GET|POST /api/cron/reputation` — nightly `reputation/v1` over the
 * `ProposalOutcome` index → `reputation/<date>.json` on the publisher, plus a
 * weekly (Sunday) onchain `ReputationSnapshot` (§8.3). `?snapshot=1` forces
 * the attestation; `?snapshot=0` suppresses it.
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { getPublisher } from "@/lib/publish";
import { getTreasuryDeps } from "@/lib/treasury/deps";
import { runReputation } from "@/lib/treasury/reputation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const q = new URL(req.url).searchParams.get("snapshot");
  const started = Date.now();
  try {
    const out = await runReputation(db, getTreasuryDeps(), {
      publisher: getPublisher(),
      ...(q === "1" ? { snapshot: true } : q === "0" ? { snapshot: false } : {}),
    });
    return json(200, {
      job: "reputation",
      run_id: out.run_id,
      key: out.key,
      scores_uri: out.scores_uri,
      inputs: out.inputs,
      scores: out.scores,
      root_of_uids: out.file.root_of_uids,
      snapshots: out.snapshot_uids,
      took_ms: Date.now() - started,
    });
  } catch (err) {
    console.error("[cron/reputation]", err);
    return json(500, { job: "reputation", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
