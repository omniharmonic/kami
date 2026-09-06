/**
 * `POST /api/gate/provenance` — the gate says where the model that answers
 * actually runs.
 *
 *   { at?, host?, gate_version?, slug?, provenance: { placement, provider?,
 *     model?, upstream_url?, authenticated?, api_key_env?, guard? } }
 *
 * Stored in `config` under `gate_provenance.<slug or "default">` with the time
 * it arrived, so the public "how I work" page renders a reported fact rather
 * than a sentence someone wrote once and forgot (PRD G7; ERRATA row 7).
 * `placement` is required here because it is required in `gate.yaml`: a gate
 * that cannot say where its model runs does not start, and must not be able to
 * register as if it had.
 *
 * A report that stops arriving goes stale like any other reading — the renderer
 * decides what to say then; this route only records what was said and when.
 *
 * Auth: `X-Gate-Admin`/bearer `GATE_ADMIN_SECRET`, the same as the heartbeat.
 */
import { z } from "zod";
import { getDb } from "@/db/client";
import { isAdminToken, isGateSecret, json, setConfig, slugOk } from "@/lib/jobs/common";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const provenanceSchema = z.object({
  /** owned = hardware the project controls; rented = a GPU box it rents; hosted = someone else's API. */
  placement: z.enum(["owned", "rented", "hosted"]),
  provider: z.string().max(200).nullish(),
  model: z.string().max(200).nullish(),
  upstream_url: z.string().max(400).nullish(),
  authenticated: z.boolean().nullish(),
  /** The NAME of the env var holding the upstream key. Never its value. */
  api_key_env: z.string().max(120).nullish(),
  guard: z.enum(["factguard", "passthrough"]).nullish(),
  note: z.string().max(500).nullish(),
});

const bodySchema = z.object({
  at: z.string().max(40).optional(),
  host: z.string().max(120).optional(),
  gate_version: z.string().max(60).nullish(),
  slug: z.string().max(64).nullish(),
  provenance: provenanceSchema,
});

export async function POST(req: Request) {
  if (!isGateSecret(req) && !isAdminToken(req)) return json(401, { reason: "unauthorized" });
  const db = getDb();
  if (!db) return json(503, { reason: "no_database" });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  // Accept the gate's envelope `{at, host, provenance:{…}}` and a bare provenance object,
  // so `curl -d '{"placement":"hosted"}'` works when someone is debugging a box by hand.
  const envelope = raw && typeof raw === "object" && !Array.isArray(raw) && !("provenance" in raw) && "placement" in raw ? { provenance: raw } : (raw ?? {});
  const parsed = bodySchema.safeParse(envelope);
  if (!parsed.success) {
    return json(400, { reason: "bad_request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  }
  const { at, host, gate_version, slug, provenance } = parsed.data;
  if (slug && !slugOk(slug)) return json(400, { reason: "bad_slug" });
  const now = new Date();
  const reportedAt = at && Number.isFinite(Date.parse(at)) ? new Date(Date.parse(at)).toISOString() : now.toISOString();
  const key = `gate_provenance.${slug || "default"}`;
  try {
    // `at` is the reader's timestamp field (apps/web/src/lib/provenance.ts): a report is a
    // reading like any other, shown as last-known with its time once it goes stale.
    await setConfig(db, key, { ...provenance, at: reportedAt, slug: slug ?? null, host: host ?? null, gate_version: gate_version ?? null, reported_at: reportedAt, received_at: now.toISOString() }, now);
    return json(200, { key, reported_at: reportedAt });
  } catch (err) {
    console.error("[gate/provenance]", err);
    return json(500, { reason: (err as Error).message });
  }
}
