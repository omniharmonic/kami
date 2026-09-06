/**
 * `POST /api/webhooks/hermes` — Hermes cron deliveries (architecture §6.2).
 * HMAC-SHA256 over `"<timestamp>.<raw body>"` with `HERMES_WEBHOOK_SECRET`,
 * constant-time compare, 5-minute window, event-id idempotency. Bodies are
 * read raw so the signature covers exactly what was sent.
 */
import { getDb } from "@/db/client";
import { jobsEnv, json } from "@/lib/jobs/common";
import { handleHermesDelivery, verifyHermesSignature } from "@/lib/jobs/hermes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const env = jobsEnv();
  const check = verifyHermesSignature(req.headers, raw, env.HERMES_WEBHOOK_SECRET);
  if (!check.ok) {
    const status = check.reason === "no_secret" ? 503 : 401;
    return json(status, { reason: check.reason });
  }
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { reason: "bad_json" });
  }
  try {
    const outcome = await handleHermesDelivery(db, body, { guardHeader: req.headers.get("x-guard") });
    if (!outcome.ok) return json(outcome.status, { reason: outcome.reason, details: outcome.details ?? null });
    return json(200, outcome);
  } catch (err) {
    console.error("[webhooks/hermes]", err);
    return json(500, { reason: (err as Error).message });
  }
}
