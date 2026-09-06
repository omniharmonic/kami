/**
 * `GET|POST /api/cron/passport` — daily Human Passport refresh for everyone who
 * claimed or was paid in the last 90 days (plan T2.14).
 *
 * Without `PASSPORT_API_KEY` the run is an honest no-op: 200 with
 * `no_api_key: true` and not a single write. An absent score must never be
 * mistaken for a low one.
 */
import { getDb } from "@/db/client";
import { authorizeCron, json } from "@/lib/jobs/common";
import { runPassportRefresh } from "@/lib/passport/refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request): Promise<Response> {
  const denied = authorizeCron(req);
  if (denied) return denied;
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") ?? "90");
  const limit = Number(url.searchParams.get("limit") ?? "500");
  const started = Date.now();
  try {
    const result = await runPassportRefresh(db, {}, { days: Number.isFinite(days) ? days : 90, limit: Number.isFinite(limit) ? limit : 500 });
    return json(200, { job: "passport", ...result, took_ms: Date.now() - started });
  } catch (err) {
    console.error("[cron/passport]", err);
    return json(500, { job: "passport", reason: (err as Error).message });
  }
}

export const GET = handle;
export const POST = handle;
