/**
 * `POST /api/webhooks/stripe` (architecture §6.2, §6.6). Node runtime, raw
 * body: the signature covers exactly the bytes Stripe sent, so nothing may
 * parse the body first. Idempotency, the ledger write and the refusals all
 * live in `src/lib/donations/webhook.ts`.
 */
import { getDb } from "@/db/client";
import { json } from "@/lib/jobs/common";
import { donationsEnv } from "@/lib/donations/env";
import { getStripe } from "@/lib/donations/stripe";
import { handleStripeWebhook } from "@/lib/donations/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text();
  const env = donationsEnv();
  const stripe = await getStripe(env);
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  try {
    const result = await handleStripeWebhook(
      db,
      { stripe, webhookSecret: env.STRIPE_WEBHOOK_SECRET, log: (l) => console.log(`[stripe] ${l}`) },
      { rawBody: raw, signature: req.headers.get("stripe-signature") },
    );
    if (!result.ok) return json(result.status, { reason: result.code, detail: result.message, event_id: result.event_id ?? null });
    return json(200, { received: true, event_id: result.event_id, type: result.type, outcome: result.outcome, donation_id: result.donation_id ?? null, fee_source: result.fee_source ?? null });
  } catch (err) {
    console.error("[webhooks/stripe]", err);
    // 500 so Stripe retries; the event-id claim was released.
    return json(500, { reason: "handler_failed" });
  }
}
