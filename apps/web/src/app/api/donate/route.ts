/**
 * `POST /api/donate` — create a one-time Stripe Checkout Session and return
 * its URL. Signed-in donors are attributed (so their monthly report reaches
 * them); anonymous donors are not asked to sign in.
 *
 * Body: `{ slug: string, amount_usd: number }`.
 */
import { getDb } from "@/db/client";
import { entityBySlug, json, slugOk } from "@/lib/jobs/common";
import { donationsEnv } from "@/lib/donations/env";
import { createCheckoutSession, getStripe } from "@/lib/donations/stripe";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { reason: "bad_json" });
  }
  const b = (body ?? {}) as { slug?: unknown; amount_usd?: unknown };
  const slug = typeof b.slug === "string" ? b.slug : "";
  const amountUsd = typeof b.amount_usd === "number" ? b.amount_usd : Number(b.amount_usd);
  if (!slugOk(slug)) return json(400, { reason: "bad_slug" });
  if (!Number.isFinite(amountUsd)) return json(400, { reason: "amount_invalid", detail: "Enter an amount greater than zero." });

  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  const entity = await entityBySlug(db, slug);
  if (!entity) return json(404, { reason: "entity_not_found" });

  const session = await getSession();
  const env = donationsEnv();
  const stripe = await getStripe(env);
  const result = await createCheckoutSession(
    db,
    { stripe, env, log: (l) => console.log(`[donations] ${l}`) },
    { entityId: entity.id, slug: entity.slug, amountUsd, donorUserId: session?.user.id ?? null },
  );
  if (!result.ok) return json(result.status, { reason: result.code, detail: result.message });
  return json(200, { url: result.url, session_id: result.session_id, donation_id: result.donation_id, amount_usd: result.amount_usd });
}
