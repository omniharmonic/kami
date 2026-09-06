/**
 * `GET|POST /api/cron/donor-report` — the 1st of the month (architecture §7.7).
 * One report per active entity for the previous month. Refuses per entity when
 * `config.donor_report_blocked.<slug>` is set; a refusal is a 409 with the
 * blocked slugs named, not a silent skip.
 *
 * `?slug=` limits it to one entity, `?month=YYYY-MM-01` re-runs a month,
 * `?force=1` re-sends one already sent (a human decision, never the cron's).
 */
import { getDb } from "@/db/client";
import { activeEntities, authorizeCron, json } from "@/lib/jobs/common";
import { runDonorReports } from "@/lib/reports/donor-report";
import { pollDirectDonations } from "@/lib/donations/direct";
import { pruneStripeEvents } from "@/lib/donations/webhook";
import { getTreasuryDeps } from "@/lib/treasury/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") ?? undefined;
  const month = url.searchParams.get("month") ?? undefined;
  const force = url.searchParams.get("force") === "1";
  const started = Date.now();
  const deps = getTreasuryDeps();
  try {
    // Catch up on USDC sent straight to a Safe before the month is totted up
    // (architecture §7.6: the Transaction Service has no webhooks). A transfer
    // we cannot read is reported, never assumed to be absent.
    const direct: Array<{ entity: string; recorded: number; error?: string }> = [];
    for (const e of await activeEntities(db, slug)) {
      const p = await pollDirectDonations(db, deps, e);
      if (p.recorded.length || p.error) direct.push({ entity: p.entity, recorded: p.recorded.length, ...(p.error ? { error: p.error } : {}) });
    }
    const results = await runDonorReports(db, deps, { ...(slug ? { slug } : {}), ...(month ? { month } : {}), force });
    const blocked = results.filter((r) => !r.ok && r.code === "reconciliation_blocked").map((r) => r.entity);
    const failed = results.filter((r) => !r.ok && r.code === "mail_failed").map((r) => r.entity);
    // idempotency keys only have to outlive Stripe's retry window (§11 retention)
    let pruned = 0;
    try {
      pruned = await pruneStripeEvents(db, new Date(deps.now().getTime() - 45 * 86_400_000));
    } catch (err) {
      console.warn("[cron/donor-report] stripe event prune failed", (err as Error).message);
    }
    const status = blocked.length || failed.length ? 409 : 200;
    return json(status, { job: "donor-report", direct_donations: direct, reports: results.length, sent: results.filter((r) => r.ok).length, blocked, failed, results, stripe_events_pruned: pruned, took_ms: Date.now() - started });
  } catch (err) {
    console.error("[cron/donor-report]", err);
    return json(500, { job: "donor-report", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
