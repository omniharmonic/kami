/**
 * `GET|POST /api/cron/needs` — the hourly needs job (ADR-E14, plan T1.4).
 * Vercel cron calls it with `Authorization: Bearer $CRON_SECRET`.
 * `?slug=` limits the run to one entity (used by the smoke test and /admin).
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { runNeedsJob } from "@/lib/jobs/needs";

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
    const out = await runNeedsJob({ db, ...(slug ? { slug } : {}) });
    const errors = out.results.filter((r) => r.status === "error").length;
    return json(errors ? 207 : 200, { job: "needs", ...out, took_ms: Date.now() - started });
  } catch (err) {
    console.error("[cron/needs]", err);
    return json(500, { job: "needs", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
