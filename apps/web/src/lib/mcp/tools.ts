/**
 * The platform MCP's nine tools as plain functions over a `ToolContext`
 * (architecture §6.2; plan T1.4, T2.7; `config.yaml.tmpl` include list).
 * Scope is the token's entity and nothing else: every query is filtered by
 * `entity.id`, and every result carries the disclosure label (ADR-E13).
 *
 * Nothing here returns geometry, claimant PII, or evidence file contents.
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type { HealthSnapshot } from "@kami/needs";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { disclosureLabel } from "@/copy";
import { deltasSince, hasNotableDelta, type Delta } from "@/lib/deltas";
import { BountyDraftError, storeBountyDraft, storeDonorReportNarrative, storePulse, storeStrategy } from "@/lib/jobs/drafts";
import { loadCurrentBinding, latestSnapshotRow, type CurrentBinding, type EntityRow } from "@/lib/jobs/needs";
import { baselineSnapshot, snapshotAtLastPulse } from "@/lib/jobs/precheck";
import { buildEntityConfig, entityConfigSystemMessage, type EntityConfig } from "./entity-config";
import { sanitizeEvidenceSummary } from "./evidence";

export type ToolContext = { db: DbOrTx; entity: EntityRow; binding: CurrentBinding | null; now: Date };

export class ToolError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: unknown = undefined,
  ) {
    super(message);
  }
}

/** Serialize agent writes with the row updated by guardian pause/retirement.
 * Request-time state may already be stale by the time a tool starts. The lock
 * is held until both the output and its audit event commit, so a completed
 * pause cannot be followed by a write using an old ToolContext.
 */
async function withActiveEntityWrite<T>(ctx: ToolContext, write: (locked: ToolContext) => Promise<T>): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    const [entity] = await tx.select().from(schema.entities)
      .where(eq(schema.entities.id, ctx.entity.id)).limit(1).for("update");
    if (!entity || entity.slug !== ctx.entity.slug) throw new ToolError("not_found", "entity unavailable");
    if (entity.retiredAt) throw new ToolError("retired", "This being is retired; agent writes are disabled.");
    if (entity.pausedAt) throw new ToolError("paused", "This being is paused; agent writes are disabled. Read tools remain available.");
    const loaded = await loadCurrentBinding(tx, entity);
    return write({ ...ctx, db: tx, entity, binding: "error" in loaded ? null : loaded });
  });
}

export function disclosureFor(entity: EntityRow): string {
  return disclosureLabel(entity.name, entity.archetype);
}

// ---------------------------------------------------------------------------
// get_needs_snapshot
// ---------------------------------------------------------------------------

export type NeedsSnapshotResult = {
  snapshot_id: number | null;
  snapshot_hash: string | null;
  as_of: string | null;
  snapshot: HealthSnapshot | null;
  deltas: Delta[];
  notable: boolean;
  last_pulse: { id: number; at: string; snapshot_id: number | null } | null;
};

export async function getNeedsSnapshot(ctx: ToolContext): Promise<NeedsSnapshotResult> {
  const latest = await latestSnapshotRow(ctx.db, ctx.entity.id);
  const last = await snapshotAtLastPulse(ctx.db, ctx.entity.id);
  const snapshot = latest ? (latest.snapshot as HealthSnapshot) : null;
  const baseline = snapshot ? await baselineSnapshot(ctx.db, ctx.entity.id, latest) : null;
  const deltas = snapshot ? deltasSince(baseline, snapshot) : [];
  return {
    snapshot_id: latest?.id ?? null,
    snapshot_hash: latest?.snapshotHash ?? null,
    as_of: latest?.asOf.toISOString() ?? null,
    snapshot,
    deltas,
    notable: hasNotableDelta(deltas),
    last_pulse: last ? { id: last.pulse.id, at: last.pulse.at.toISOString(), snapshot_id: last.pulse.snapshotId } : null,
  };
}

// ---------------------------------------------------------------------------
// get_entity_config
// ---------------------------------------------------------------------------

export async function getEntityConfig(ctx: ToolContext): Promise<{ config: EntityConfig; system_message: string }> {
  const config = await buildEntityConfig(ctx.db, ctx.entity, ctx.binding);
  return { config, system_message: entityConfigSystemMessage(config) };
}

// ---------------------------------------------------------------------------
// post_update
// ---------------------------------------------------------------------------

export const postUpdateSchema = z.object({
  kind: z.enum(["pulse", "reflection", "note", "strategy", "donor_report"]),
  snapshot_id: z.number().int().positive().nullable().optional(),
  text: z.string().max(8000).nullable().optional(),
  /** the delivering pipeline's guard verdict, when it travels with the call */
  guard_result: z.enum(["pass", "dropped", "held"]).nullable().optional(),
});

export type PostUpdateInput = z.infer<typeof postUpdateSchema>;

export async function postUpdate(ctx: ToolContext, raw: unknown): Promise<Record<string, unknown>> {
  return withActiveEntityWrite(ctx, (locked) => postUpdateActive(locked, raw));
}

async function postUpdateActive(ctx: ToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const parsed = postUpdateSchema.safeParse(raw);
  if (!parsed.success) throw new ToolError("bad_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const input = parsed.data;
  const text = input.text?.trim() ? input.text.trim() : null;
  const actor = `mcp:${ctx.entity.slug}`;
  const guard = input.guard_result ?? null;

  if (input.kind === "strategy") {
    if (!text) throw new ToolError("bad_request", "a strategy needs text");
    const s = await storeStrategy(ctx.db, ctx.entity, { memo_md: text, guard_result: guard, actor, now: ctx.now });
    return { kind: "strategy", ...s };
  }
  if (input.kind === "donor_report") {
    if (!text) throw new ToolError("bad_request", "a donor report needs text");
    const r = await storeDonorReportNarrative(ctx.db, ctx.entity, { narrative_md: text, guard_result: guard, actor, now: ctx.now });
    return { kind: "donor_report", ...r };
  }

  let snapshotId: number | null = input.snapshot_id ?? null;
  if (snapshotId !== null) {
    const [row] = await ctx.db.select({ id: schema.needSnapshots.id }).from(schema.needSnapshots).where(and(eq(schema.needSnapshots.id, snapshotId), eq(schema.needSnapshots.entityId, ctx.entity.id))).limit(1);
    if (!row) throw new ToolError("not_found", `snapshot ${snapshotId} is not this entity's`);
  } else {
    snapshotId = (await latestSnapshotRow(ctx.db, ctx.entity.id))?.id ?? null;
  }
  const latest = await latestSnapshotRow(ctx.db, ctx.entity.id);
  const baseline = latest ? await baselineSnapshot(ctx.db, ctx.entity.id, latest) : null;
  const deltas = latest ? deltasSince(baseline, latest.snapshot as HealthSnapshot) : [];
  const stored = await storePulse(ctx.db, ctx.entity, { kind: input.kind, snapshot_id: snapshotId, text, guard_result: guard, deltas, actor, now: ctx.now });
  return { kind: input.kind, pulse_id: stored.id, at: stored.at, snapshot_id: stored.snapshot_id, has_text: text !== null };
}

// ---------------------------------------------------------------------------
// get_strategy
// ---------------------------------------------------------------------------

export async function getStrategy(ctx: ToolContext) {
  const [ratified] = await ctx.db
    .select()
    .from(schema.strategies)
    .where(and(eq(schema.strategies.entityId, ctx.entity.id), isNotNull(schema.strategies.ratifiedAt)))
    .orderBy(desc(schema.strategies.ratifiedAt))
    .limit(1);
  const [draft] = await ctx.db
    .select({ id: schema.strategies.id, quarter: schema.strategies.quarter, createdAt: schema.strategies.createdAt, guardResult: schema.strategies.guardResult })
    .from(schema.strategies)
    .where(and(eq(schema.strategies.entityId, ctx.entity.id)))
    .orderBy(desc(schema.strategies.createdAt))
    .limit(1);
  return {
    strategy: ratified
      ? { id: ratified.id, quarter: ratified.quarter, memo_md: ratified.memoMd, ratified_at: ratified.ratifiedAt?.toISOString() ?? null, comment_open_until: ratified.commentOpenUntil?.toISOString() ?? null }
      : null,
    latest_draft: draft && (!ratified || draft.id !== ratified.id) ? { id: draft.id, quarter: draft.quarter, created_at: draft.createdAt?.toISOString() ?? null, guard_result: draft.guardResult } : null,
  };
}

// ---------------------------------------------------------------------------
// bounties
// ---------------------------------------------------------------------------

export async function listOpenBounties(ctx: ToolContext) {
  const rows = await ctx.db
    .select()
    .from(schema.bounties)
    .where(and(eq(schema.bounties.entityId, ctx.entity.id), inArray(schema.bounties.status, ["open", "claimed", "in_review"])))
    .orderBy(desc(schema.bounties.createdAt))
    .limit(20);
  return {
    bounties: rows.map((b) => ({
      id: b.id,
      title: b.title,
      status: b.status,
      verification_tier: b.verificationTier,
      cap_usdc: b.capUsdc,
      claim_limit: b.claimLimit,
      deadline: b.deadline,
      twin_refs: b.twinRefs,
      linked_strategy_id: b.strategyId,
    })),
  };
}

export async function draftBounty(ctx: ToolContext, spec: unknown) {
  return withActiveEntityWrite(ctx, (locked) => draftBountyActive(locked, spec));
}

async function draftBountyActive(ctx: ToolContext, spec: unknown) {
  try {
    const r = await storeBountyDraft(ctx.db, ctx.entity, ctx.binding, spec, { guard_result: null, actor: `mcp:${ctx.entity.slug}`, now: ctx.now });
    return { bounty_id: r.id, status: r.status, spec_sha256: r.spec_sha256 };
  } catch (err) {
    if (err instanceof BountyDraftError) throw new ToolError(err.code, err.message, err.issues);
    throw err;
  }
}

export async function listSubmissions(ctx: ToolContext) {
  const rows = await ctx.db
    .select({
      id: schema.submissions.id,
      bountyId: schema.bounties.id,
      title: schema.bounties.title,
      submittedAt: schema.submissions.submittedAt,
      evaluationOutcome: schema.evaluations.outcome,
    })
    .from(schema.submissions)
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .leftJoin(schema.evaluations, eq(schema.evaluations.submissionId, schema.submissions.id))
    .where(eq(schema.bounties.entityId, ctx.entity.id))
    .orderBy(desc(schema.submissions.submittedAt))
    .limit(50);
  return {
    submissions: rows.map((r) => ({ id: r.id, bounty_id: r.bountyId, bounty_title: r.title, submitted_at: r.submittedAt?.toISOString() ?? null, outcome: r.evaluationOutcome ?? null })),
  };
}

export async function readEvidenceSummary(ctx: ToolContext, submissionId: string) {
  const [row] = await ctx.db
    .select({ id: schema.submissions.id, summary: schema.submissions.evidenceSummary, bountyId: schema.bounties.id })
    .from(schema.submissions)
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .where(and(eq(schema.submissions.id, submissionId), eq(schema.bounties.entityId, ctx.entity.id)))
    .limit(1);
  if (!row) throw new ToolError("not_found", `submission ${submissionId} is not this entity's`);
  return { submission_id: row.id, bounty_id: row.bountyId, evidence_summary: sanitizeEvidenceSummary(row.summary) };
}

// ---------------------------------------------------------------------------
// get_attestation_summary
// ---------------------------------------------------------------------------

export async function getAttestationSummary(ctx: ToolContext) {
  const rows = await ctx.db
    .select({ uid: schema.attestations.uid, schema: schema.attestations.schema, createdAt: schema.attestations.createdAt, revokedAt: schema.attestations.revokedAt, mode: schema.attestations.mode })
    .from(schema.attestations)
    .where(eq(schema.attestations.entityId, ctx.entity.id))
    .orderBy(desc(schema.attestations.createdAt));
  const bySchema: Record<string, { count: number; revoked: number; onchain: number; offchain: number; last_uids: string[] }> = {};
  for (const r of rows) {
    const s = (bySchema[r.schema] ??= { count: 0, revoked: 0, onchain: 0, offchain: 0, last_uids: [] });
    s.count++;
    if (r.revokedAt) s.revoked++;
    if (r.mode === "onchain") s.onchain++;
    else s.offchain++;
    if (s.last_uids.length < 10) s.last_uids.push(r.uid);
  }
  return { total: rows.length, by_schema: bySchema };
}
