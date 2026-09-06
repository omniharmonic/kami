/**
 * `GET|POST /api/cron/safe-poll` — every minute: confirmations for every
 * pending Safe proposal; at threshold the relayer executes and the payout is
 * recorded and attested (architecture §7.3). Cheap when nothing is pending.
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { getTreasuryDeps } from "@/lib/treasury/deps";
import { runSafePoll } from "@/lib/treasury/safe-poll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const slug = new URL(req.url).searchParams.get("slug") ?? undefined;
  const started = Date.now();
  try {
    const out = await runSafePoll(db, getTreasuryDeps(), slug ? { slug } : {});
    return json(out.errors.length ? 207 : 200, { job: "safe-poll", ...out, took_ms: Date.now() - started });
  } catch (err) {
    console.error("[cron/safe-poll]", err);
    return json(500, { job: "safe-poll", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
