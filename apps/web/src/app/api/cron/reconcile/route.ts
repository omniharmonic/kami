/**
 * `GET|POST /api/cron/reconcile` — the nightly reconciliation (§7.7). A
 * mismatch answers 409 with the findings, writes `config.alerts.reconcile.<slug>`,
 * blocks the donor report and pages a steward.
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { runReconcile } from "@/lib/reconcile";
import { getTreasuryDeps } from "@/lib/treasury/deps";

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
    const results = await runReconcile(db, getTreasuryDeps(), slug ? { slug } : {});
    const bad = results.filter((r) => !r.ok);
    return json(bad.length ? 409 : 200, { job: "reconcile", checked: results.length, blocked: bad.map((b) => b.entity), results, took_ms: Date.now() - started });
  } catch (err) {
    console.error("[cron/reconcile]", err);
    return json(500, { job: "reconcile", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
