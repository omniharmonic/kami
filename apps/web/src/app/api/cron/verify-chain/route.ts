/**
 * `GET|POST /api/cron/verify-chain` — nightly hash-chain verification
 * (architecture §10.5). Heads land in `config.event_chain_head.<slug>` and
 * from there into `status.json`. A broken chain answers 500 loudly.
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { runVerifyChain } from "@/lib/jobs/verify-chain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const slug = new URL(req.url).searchParams.get("slug") ?? undefined;
  try {
    const heads = await runVerifyChain(db, new Date(), slug);
    const broken = heads.filter((h) => !h.ok);
    return json(broken.length ? 500 : 200, { job: "verify-chain", heads, broken: broken.map((b) => b.slug) });
  } catch (err) {
    console.error("[cron/verify-chain]", err);
    return json(500, { job: "verify-chain", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
