/**
 * Bounties — the §7.6 spec as a zod schema, its canonical hash, and the state
 * machine over `bounties.status` (Appendix A.4):
 *
 *   drafted → held_by_guard | open      (guardian approval; `config.bounty_approvals_required`, default 1)
 *   open → claimed → in_review → paid | deferred
 *   open | claimed → expired (deadline passed) | withdrawn
 *
 * `paid` is written only by the treasury package (`markBountyPaid` is exported
 * for it). Every transition appends an `entity_events` row.
 */
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { canonicalJson } from "@kami/reputation";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import type { BountyStatus } from "@/db/schema";
import { evidenceSpecSchema, type EvidenceSpec } from "@/lib/evidence/spec";
import { CONFIG_DEFAULTS, getConfigNumber } from "./config";
import { GovernanceError } from "./errors";
import { requireEntityRole } from "./roles";
import { newId, round2, usdc, withTx } from "./tx";

// --- spec ------------------------------------------------------------------

export const predictionSchema = z.object({
  place_id: z.string().min(1),
  property: z.string().min(1),
  direction: z.enum(["up", "down"]),
  /** ISO date or datetime by which the outcome should show in a reading */
  window_end: z.string().min(4),
});
export type Prediction = z.infer<typeof predictionSchema>;

export const verificationTierSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const bountySpecSchema = z
  .object({
    entity_id: z.string().regex(/^entity\/[a-z0-9-]+$/),
    title: z.string().trim().min(3).max(200),
    why: z.string().trim().min(1).max(4000),
    deliverable: z.string().trim().min(1).max(4000),
    verification_tier: verificationTierSchema,
    evidence_spec: evidenceSpecSchema,
    cap_usdc: z.number().positive().max(10_000),
    claim_limit: z.number().int().min(1).max(50).default(1),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
    /** the Evaluator hat id as a decimal string, or null before Hats (phase 2) */
    evaluator_hat: z.string().nullable().default(null),
    /** `strategies.id` when known */
    linked_strategy: z.string().nullable().default(null),
    twin_refs: z.array(z.string().min(1)).min(1).max(20),
    prediction: predictionSchema.nullable().default(null),
  })
  .superRefine((s, ctx) => {
    if (s.verification_tier === 1 && !s.prediction) {
      ctx.addIssue({ code: "custom", path: ["prediction"], message: "tier-1 bounties must carry a prediction" });
    }
  });
export type BountySpec = z.infer<typeof bountySpecSchema>;
export type BountySpecInput = z.input<typeof bountySpecSchema>;

/** Fields a guardian may not edit (PRD §7.6). */
export const IMMUTABLE_SPEC_FIELDS = ["entity_id", "twin_refs"] as const;
export const EDITABLE_SPEC_FIELDS = [
  "title",
  "why",
  "deliverable",
  "verification_tier",
  "evidence_spec",
  "cap_usdc",
  "claim_limit",
  "deadline",
  "evaluator_hat",
  "linked_strategy",
  "prediction",
] as const;

/** Parse; tier-1 without prediction → `tier1_prediction_required`, anything else → `invalid_spec`. */
export function parseBountySpec(raw: unknown): BountySpec {
  const r = bountySpecSchema.safeParse(raw);
  if (r.success) return r.data;
  const tier1 = r.error.issues.some((i) => i.path[0] === "prediction" && /tier-1/.test(i.message));
  throw new GovernanceError(tier1 ? "tier1_prediction_required" : "invalid_spec", r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
}

/** Canonical §7.6 object (sorted keys, numbers as numbers) — what `spec_sha256` and `bountyHash` cover. */
export function canonicalSpec(spec: BountySpec): Record<string, unknown> {
  return {
    entity_id: spec.entity_id,
    title: spec.title,
    why: spec.why,
    deliverable: spec.deliverable,
    verification_tier: spec.verification_tier,
    evidence_spec: spec.evidence_spec,
    cap_usdc: spec.cap_usdc,
    claim_limit: spec.claim_limit,
    deadline: spec.deadline,
    evaluator_hat: spec.evaluator_hat,
    linked_strategy: spec.linked_strategy,
    twin_refs: spec.twin_refs,
    prediction: spec.prediction,
  };
}

/** sha256 hex of the canonical spec JSON. `bountyHashOf(canonicalSpec(spec)) === "0x" + specSha256(spec)`. */
export function specSha256(spec: BountySpec): string {
  return createHash("sha256").update(canonicalJson(canonicalSpec(spec)), "utf8").digest("hex");
}

export type BountyRow = typeof schema.bounties.$inferSelect;

export function specFromRow(row: BountyRow): BountySpec {
  return bountySpecSchema.parse({
    entity_id: row.entityId,
    title: row.title,
    why: row.whyMd,
    deliverable: row.deliverableMd,
    verification_tier: row.verificationTier,
    evidence_spec: row.evidenceSpec ?? {},
    cap_usdc: usdc(row.capUsdc),
    claim_limit: row.claimLimit,
    deadline: row.deadline,
    evaluator_hat: row.evaluatorHatId === null || row.evaluatorHatId === undefined ? null : String(row.evaluatorHatId),
    linked_strategy: row.strategyId,
    twin_refs: row.twinRefs,
    prediction: row.prediction ?? null,
  });
}

function rowValuesFromSpec(spec: BountySpec) {
  return {
    entityId: spec.entity_id,
    title: spec.title,
    whyMd: spec.why,
    deliverableMd: spec.deliverable,
    verificationTier: spec.verification_tier,
    evidenceSpec: spec.evidence_spec as EvidenceSpec,
    capUsdc: spec.cap_usdc.toFixed(2),
    claimLimit: spec.claim_limit,
    deadline: spec.deadline,
    evaluatorHatId: spec.evaluator_hat && /^\d+$/.test(spec.evaluator_hat) ? spec.evaluator_hat : null,
    strategyId: spec.linked_strategy,
    twinRefs: spec.twin_refs,
    prediction: spec.prediction,
    specSha256: specSha256(spec),
  };
}

// --- state machine ---------------------------------------------------------

export const TRANSITIONS: Record<BountyStatus, readonly BountyStatus[]> = {
  drafted: ["held_by_guard", "open", "withdrawn"],
  held_by_guard: ["drafted", "open", "withdrawn"],
  open: ["claimed", "expired", "withdrawn"],
  claimed: ["open", "in_review", "expired", "withdrawn"],
  in_review: ["paid", "deferred", "open", "claimed", "expired", "withdrawn"],
  deferred: ["paid"],
  paid: [],
  expired: [],
  withdrawn: [],
};

export function canTransition(from: BountyStatus, to: BountyStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: BountyStatus, to: BountyStatus): void {
  if (!canTransition(from, to)) throw new GovernanceError("invalid_transition", `${from} → ${to}`, { from, to });
}

export async function loadBounty(db: DbOrTx, id: string, forUpdate = false): Promise<BountyRow> {
  const q = db.select().from(schema.bounties).where(eq(schema.bounties.id, id)).limit(1);
  const [row] = forUpdate ? await q.for("update") : await q;
  if (!row) throw new GovernanceError("not_found");
  return row;
}

export async function assertEntityActive(db: DbOrTx, entityId: string): Promise<typeof schema.entities.$inferSelect> {
  const [e] = await db.select().from(schema.entities).where(eq(schema.entities.id, entityId)).limit(1);
  if (!e) throw new GovernanceError("not_found");
  if (e.retiredAt) throw new GovernanceError("retired");
  if (e.pausedAt) throw new GovernanceError("paused");
  return e;
}

/** Generic transition + event. Callers hold the row lock when it matters. */
export async function transitionBounty(
  tx: DbOrTx,
  row: BountyRow,
  to: BountyStatus,
  actor: string | null,
  payload: Record<string, unknown> = {},
  now = new Date(),
): Promise<BountyRow> {
  assertTransition(row.status, to);
  const [updated] = await tx.update(schema.bounties).set({ status: to }).where(eq(schema.bounties.id, row.id)).returning();
  await appendEntityEvent(tx, {
    entity_id: row.entityId!,
    actor,
    kind: `bounty_${to}`,
    payload: { bounty_id: row.id, from: row.status, to, spec_sha256: row.specSha256, ...payload },
    at: now,
  });
  return updated!;
}

// --- lifecycle -------------------------------------------------------------

/** Insert a draft (the platform MCP's `draft_bounty` does the same insert; this is for humans and tests). */
export async function createBountyDraft(
  db: DbOrTx,
  raw: BountySpecInput,
  opts: { actor: string | null; proposal_id?: string | null; held_by_guard?: boolean; now?: Date; id?: string } = { actor: null },
): Promise<BountyRow> {
  const spec = parseBountySpec(raw);
  const now = opts.now ?? new Date();
  return withTx(db, async (tx) => {
    const id = opts.id ?? newId("bounty");
    const status: BountyStatus = opts.held_by_guard ? "held_by_guard" : "drafted";
    const [row] = await tx
      .insert(schema.bounties)
      .values({ id, ...rowValuesFromSpec(spec), proposalId: opts.proposal_id ?? null, status, createdAt: now })
      .returning();
    await appendEntityEvent(tx, {
      entity_id: spec.entity_id,
      actor: opts.actor,
      kind: `bounty_${status}`,
      payload: { bounty_id: id, spec_sha256: row!.specSha256, verification_tier: spec.verification_tier, cap_usdc: spec.cap_usdc },
      at: now,
    });
    return row!;
  });
}

export async function holdByGuard(db: DbOrTx, id: string, reason: string, now = new Date()): Promise<BountyRow> {
  return withTx(db, async (tx) => transitionBounty(tx, await loadBounty(tx, id, true), "held_by_guard", null, { reason }, now));
}

export type ApproveEdits = Partial<Record<(typeof EDITABLE_SPEC_FIELDS)[number], unknown>> & Record<string, unknown>;

export type ApproveResult = {
  bounty: BountyRow;
  approvals: number;
  required: number;
  opened: boolean;
  edited_fields: string[];
  spec_sha256: string;
};

/**
 * Guardian approval, optionally with edits (any field except `entity_id` and
 * `twin_refs`). Approvals are keyed to the resulting `spec_sha256` AND the
 * latest spec-changing event, so even restoring an earlier spec restarts the
 * count. Event ids preserve ordering when multiple edits share a timestamp.
 * When `approvals ≥ config.bounty_approvals_required` the bounty opens.
 * PRD §7.1's 72 hours is the approval-latency SLA, not an expiry policy;
 * the architecture specifies no automatic expiry of a pending draft.
 */
export async function approveBounty(db: DbOrTx, id: string, guardianUserId: string, edits: ApproveEdits = {}, deps: { now?: Date } = {}): Promise<ApproveResult> {
  const now = deps.now ?? new Date();
  for (const k of Object.keys(edits)) {
    if ((IMMUTABLE_SPEC_FIELDS as readonly string[]).includes(k)) throw new GovernanceError("immutable_field", k, { field: k });
    if (!(EDITABLE_SPEC_FIELDS as readonly string[]).includes(k)) throw new GovernanceError("invalid_spec", `unknown field ${k}`);
  }
  return withTx(db, async (tx) => {
    const row = await loadBounty(tx, id, true);
    await assertEntityActive(tx, row.entityId!);
    await requireEntityRole(tx, guardianUserId, row.entityId!, ["guardian"]);
    if (row.status !== "drafted" && row.status !== "held_by_guard") throw new GovernanceError("invalid_transition", `${row.status} → open`);

    const current = specFromRow(row);
    const merged: Record<string, unknown> = { ...canonicalSpec(current) };
    const edited_fields: string[] = [];
    for (const [k, v] of Object.entries(edits)) {
      if (v === undefined) continue;
      if (k === "evidence_spec" && v && typeof v === "object") merged.evidence_spec = { ...(current.evidence_spec as object), ...(v as object) };
      else merged[k] = v;
      edited_fields.push(k);
    }
    const spec = parseBountySpec(merged);
    const values = rowValuesFromSpec(spec);
    const changed = values.specSha256 !== row.specSha256;
    if (changed) await tx.update(schema.bounties).set(values).where(eq(schema.bounties.id, id));

    const required = await getConfigNumber(tx, "bounty_approvals_required", CONFIG_DEFAULTS.bounty_approvals_required);
    await appendEntityEvent(tx, {
      entity_id: row.entityId!,
      actor: guardianUserId,
      kind: "bounty_approved",
      payload: { bounty_id: id, spec_sha256: values.specSha256, previous_sha256: row.specSha256, edited_fields: changed ? edited_fields : [] },
      at: now,
    });
    // Restoring an old hash must not revive the approvals from its previous
    // incarnation. Existing audit payloads already record both hashes, so no
    // migration or mutable revision counter is needed. The bounty row remains
    // locked for the entire edit, event append, and approval count.
    const [revision] = await tx
      .select({ id: sql<number | null>`max(${schema.entityEvents.id})` })
      .from(schema.entityEvents)
      .where(and(
        eq(schema.entityEvents.entityId, row.entityId!),
        eq(schema.entityEvents.kind, "bounty_approved"),
        sql`${schema.entityEvents.payload} ->> 'bounty_id' = ${id}`,
        sql`(${schema.entityEvents.payload} ->> 'previous_sha256') is distinct from (${schema.entityEvents.payload} ->> 'spec_sha256')`,
      ));
    const [cnt] = await tx
      .select({ n: sql<number>`count(distinct ${schema.entityEvents.actor})::int` })
      .from(schema.entityEvents)
      .where(
        and(
          eq(schema.entityEvents.entityId, row.entityId!),
          eq(schema.entityEvents.kind, "bounty_approved"),
          sql`${schema.entityEvents.payload} ->> 'bounty_id' = ${id}`,
          sql`${schema.entityEvents.payload} ->> 'spec_sha256' = ${values.specSha256}`,
          gte(schema.entityEvents.id, revision?.id ?? 0),
        ),
      );
    const approvals = cnt?.n ?? 1;
    let fresh = await loadBounty(tx, id);
    let opened = false;
    if (approvals >= required) {
      await tx.update(schema.bounties).set({ approvedBy: guardianUserId, approvedAt: now }).where(eq(schema.bounties.id, id));
      fresh = await transitionBounty(tx, await loadBounty(tx, id), "open", guardianUserId, { approvals, required }, now);
      opened = true;
    }
    return { bounty: fresh, approvals, required, opened, edited_fields: changed ? edited_fields : [], spec_sha256: values.specSha256 };
  });
}

async function releaseAllClaims(tx: DbOrTx, bountyId: string, now: Date): Promise<number> {
  const rows = await tx
    .update(schema.claims)
    .set({ releasedAt: now })
    .where(and(eq(schema.claims.bountyId, bountyId), sql`${schema.claims.releasedAt} is null`))
    .returning({ id: schema.claims.id });
  return rows.length;
}

export async function withdrawBounty(db: DbOrTx, id: string, byUserId: string, reason: string | null = null, deps: { now?: Date } = {}): Promise<BountyRow> {
  const now = deps.now ?? new Date();
  return withTx(db, async (tx) => {
    const row = await loadBounty(tx, id, true);
    await requireEntityRole(tx, byUserId, row.entityId!, ["guardian", "steward"]);
    const released = await releaseAllClaims(tx, id, now);
    return transitionBounty(tx, row, "withdrawn", byUserId, { reason, claims_released: released }, now);
  });
}

/** Expire open/claimed/in-review-less bounties whose deadline has passed. Returns the ids expired. */
export async function expireBounties(db: DbOrTx, opts: { today?: string; entity_id?: string } = {}): Promise<string[]> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const conds = [inArray(schema.bounties.status, ["open", "claimed"]), lt(schema.bounties.deadline, today)];
  if (opts.entity_id) conds.push(eq(schema.bounties.entityId, opts.entity_id));
  const due = await db.select({ id: schema.bounties.id }).from(schema.bounties).where(and(...conds));
  const out: string[] = [];
  for (const { id } of due) {
    await withTx(db, async (tx) => {
      const row = await loadBounty(tx, id, true);
      if (row.status !== "open" && row.status !== "claimed") return;
      const released = await releaseAllClaims(tx, id, new Date());
      await transitionBounty(tx, row, "expired", null, { deadline: row.deadline, claims_released: released });
      out.push(id);
    });
  }
  return out;
}

export async function expireBounty(db: DbOrTx, id: string, now = new Date()): Promise<BountyRow> {
  return withTx(db, async (tx) => {
    const row = await loadBounty(tx, id, true);
    if (!row.deadline || row.deadline >= now.toISOString().slice(0, 10)) throw new GovernanceError("invalid_transition", "deadline not passed");
    const released = await releaseAllClaims(tx, id, now);
    return transitionBounty(tx, row, "expired", null, { deadline: row.deadline, claims_released: released }, now);
  });
}

/** For the treasury package: the Safe tx executed, the payout row exists. */
export async function markBountyPaid(db: DbOrTx, id: string, actor: string | null, payload: { payout_id: string; safe_tx_hash?: string | null; eas_uid_completed?: string | null }, now = new Date()) {
  return withTx(db, async (tx) => transitionBounty(tx, await loadBounty(tx, id, true), "paid", actor, payload, now));
}

/** Retro: an anchor for GPS checks from the latest binding (`anchor_centroid` or `bbox`), else null. */
export async function bountyAnchor(db: DbOrTx, entityId: string): Promise<{ lat: number; lon: number } | null> {
  const [b] = await db
    .select({ binding: schema.entityBindings.binding })
    .from(schema.entityBindings)
    .where(eq(schema.entityBindings.entityId, entityId))
    .orderBy(sql`${schema.entityBindings.bindingVersion} desc`)
    .limit(1);
  const binding = (b?.binding ?? null) as { anchor_centroid?: { lat: number; lon: number }; anchor_bbox?: number[] } | null;
  if (!binding) return null;
  if (binding.anchor_centroid && Number.isFinite(binding.anchor_centroid.lat) && Number.isFinite(binding.anchor_centroid.lon)) return binding.anchor_centroid;
  if (binding.anchor_bbox && binding.anchor_bbox.length === 4) {
    const [w, s, e, n] = binding.anchor_bbox as [number, number, number, number];
    return { lat: round2((s + n) / 2 * 100) / 100, lon: round2((w + e) / 2 * 100) / 100 };
  }
  return null;
}
