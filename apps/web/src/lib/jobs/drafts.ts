/**
 * Where the agent's outputs land (architecture §5.2, §6.7). Shared by the
 * Hermes webhook (cron deliveries) and the platform MCP's `post_update`:
 *
 *   pulse / reflection / note  → `pulses` (woke = true) + `entity_events`
 *   weekly-bounties            → `bounties` (`drafted`, or `held_by_guard`)
 *   quarterly-strategy         → `strategies` (unratified)
 *   donor-report               → `donor_reports.narrative_md`
 *
 * The guard's verdict travels with each delivery (`pass | dropped | held`);
 * `held` parks a bounty at `held_by_guard` for a steward.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { appendEntityEvent, type DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { bountySpecSchema, capsFrom, DEFAULT_DRAFTS_PER_WEEK, isoWeekBounds, specSha256, type BountySpec } from "@/lib/mcp/bounty-spec";
import { getConfig } from "./common";
import type { CurrentBinding, EntityRow } from "./needs";

export type GuardResult = "pass" | "dropped" | "held";

export function normalizeGuard(v: unknown): GuardResult | null {
  if (typeof v !== "string") return null;
  const s = v.toLowerCase();
  if (s === "pass" || s === "passed" || s === "ok" || s === "released") return "pass";
  if (s === "dropped" || s === "drop") return "dropped";
  if (s === "held" || s === "hold" || s === "held_by_guard") return "held";
  return null;
}

export type StoredPulse = { id: number; at: string; snapshot_id: number | null };

export async function storePulse(
  db: DbOrTx,
  entity: EntityRow,
  input: { kind: "pulse" | "reflection" | "note"; snapshot_id: number | null; text: string | null; guard_result: GuardResult | null; deltas?: unknown; actor: string; now?: Date; tokens?: { prompt?: number; output?: number } },
): Promise<StoredPulse> {
  const now = input.now ?? new Date();
  const [row] = await db
    .insert(schema.pulses)
    .values({
      entityId: entity.id,
      at: now,
      woke: true,
      snapshotId: input.snapshot_id,
      deltas: input.deltas ?? null,
      text: input.text,
      guardResult: input.guard_result,
      tokensPrompt: input.tokens?.prompt ?? null,
      tokensOutput: input.tokens?.output ?? null,
    })
    .returning();
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor: input.actor,
    kind: `${input.kind}.posted`,
    payload: { pulse_id: row!.id, snapshot_id: input.snapshot_id, has_text: Boolean(input.text), guard_result: input.guard_result },
    at: now,
  });
  return { id: row!.id, at: now.toISOString(), snapshot_id: input.snapshot_id };
}

/** "2026-Q3" for a date. */
export function quarterOf(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export async function storeStrategy(
  db: DbOrTx,
  entity: EntityRow,
  input: { memo_md: string; guard_result: GuardResult | null; quarter?: string; actor: string; now?: Date },
): Promise<{ id: string; quarter: string; replaced: boolean }> {
  const now = input.now ?? new Date();
  const quarter = input.quarter ?? quarterOf(now);
  const [existing] = await db
    .select()
    .from(schema.strategies)
    .where(and(eq(schema.strategies.entityId, entity.id), eq(schema.strategies.quarter, quarter)))
    .limit(1);
  if (existing && existing.ratifiedAt) {
    throw new Error(`strategy ${quarter} is already ratified; a new draft must wait for the next quarter`);
  }
  const id = existing?.id ?? randomUUID();
  const commentOpenUntil = new Date(now.getTime() + 7 * 86400_000);
  if (existing) {
    await db.update(schema.strategies).set({ memoMd: input.memo_md, guardResult: input.guard_result, commentOpenUntil }).where(eq(schema.strategies.id, id));
  } else {
    await db.insert(schema.strategies).values({ id, entityId: entity.id, quarter, memoMd: input.memo_md, guardResult: input.guard_result, commentOpenUntil, createdAt: now });
  }
  await appendEntityEvent(db, { entity_id: entity.id, actor: input.actor, kind: "strategy.drafted", payload: { strategy_id: id, quarter, guard_result: input.guard_result, replaced: Boolean(existing) }, at: now });
  return { id, quarter, replaced: Boolean(existing) };
}

/** "2026-09-01" — the first day of the month a report covers (the previous month on the 1st). */
export function reportMonthOf(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const prev = new Date(Date.UTC(y, m - 1, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function storeDonorReportNarrative(
  db: DbOrTx,
  entity: EntityRow,
  input: { narrative_md: string; guard_result: GuardResult | null; month?: string; actor: string; now?: Date; delivery_id?: string },
): Promise<{ id: string; month: string }> {
  const now = input.now ?? new Date();
  const month = input.month ?? reportMonthOf(now);
  const [existing] = await db
    .select()
    .from(schema.donorReports)
    .where(and(eq(schema.donorReports.entityId, entity.id), eq(schema.donorReports.month, month)))
    .limit(1);
  const id = existing?.id ?? randomUUID();
  if (existing) {
    await db.update(schema.donorReports).set({ narrativeMd: input.narrative_md, guardResult: input.guard_result }).where(eq(schema.donorReports.id, id));
  } else {
    await db.insert(schema.donorReports).values({
      id,
      entityId: entity.id,
      month,
      data: { source: "agent", delivery_id: input.delivery_id ?? null, numbers: null },
      narrativeMd: input.narrative_md,
      guardResult: input.guard_result,
    });
  }
  await appendEntityEvent(db, { entity_id: entity.id, actor: input.actor, kind: "donor_report.narrative", payload: { report_id: id, month, guard_result: input.guard_result }, at: now });
  return { id, month };
}

// ---------------------------------------------------------------------------
// bounty drafts
// ---------------------------------------------------------------------------

export class BountyDraftError extends Error {
  constructor(
    public code: "invalid_spec" | "foreign_twin_ref" | "cap_out_of_range" | "weekly_limit" | "wrong_entity",
    message: string,
    public issues: string[] = [],
  ) {
    super(message);
  }
}

export function bindingIds(binding: CurrentBinding | null): Set<string> {
  const ids = new Set<string>();
  if (!binding) return ids;
  ids.add(binding.binding.anchor);
  for (const m of binding.binding.members) ids.add(m.id);
  for (const w of binding.binding.watersheds) ids.add(w);
  if (binding.binding.stream_id) ids.add(binding.binding.stream_id);
  return ids;
}

export async function draftsThisWeek(db: DbOrTx, entityId: string, now: Date): Promise<number> {
  const { start, end } = isoWeekBounds(now);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bounties)
    .where(and(eq(schema.bounties.entityId, entityId), gte(schema.bounties.createdAt, start), lt(schema.bounties.createdAt, end)));
  return r?.n ?? 0;
}

/**
 * Validate a §7.6 spec against the entity and insert it as `drafted`
 * (`held_by_guard` when the guard held it). Throws `BountyDraftError` with a
 * code the caller can surface.
 */
export async function storeBountyDraft(
  db: DbOrTx,
  entity: EntityRow,
  binding: CurrentBinding | null,
  rawSpec: unknown,
  opts: { guard_result: GuardResult | null; actor: string; now?: Date; strategy_id?: string | null },
): Promise<{ id: string; status: "drafted" | "held_by_guard"; spec_sha256: string; spec: BountySpec }> {
  const now = opts.now ?? new Date();
  const parsed = bountySpecSchema.safeParse(rawSpec);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "spec"}: ${i.message}`);
    throw new BountyDraftError("invalid_spec", `bounty spec rejected: ${issues.join("; ")}`, issues);
  }
  const spec = parsed.data;
  if (spec.entity_id && spec.entity_id !== entity.id) throw new BountyDraftError("wrong_entity", `spec.entity_id ${spec.entity_id} is not ${entity.id}`);
  spec.entity_id = entity.id;

  const allowed = bindingIds(binding);
  const foreign = spec.twin_refs.filter((id) => !allowed.has(id));
  if (foreign.length) throw new BountyDraftError("foreign_twin_ref", `twin_refs outside the binding: ${foreign.join(", ")}`, foreign);

  const caps = capsFrom(await getConfig(db, "bounty_cap_usdc"));
  if (spec.cap_usdc < caps.min || spec.cap_usdc > caps.max) {
    throw new BountyDraftError("cap_out_of_range", `cap_usdc ${spec.cap_usdc} outside ${caps.min}–${caps.max}`);
  }

  const perWeek = (await getConfig<number>(db, "bounty_drafts_per_week")) ?? DEFAULT_DRAFTS_PER_WEEK;
  const n = await draftsThisWeek(db, entity.id, now);
  if (n >= perWeek) throw new BountyDraftError("weekly_limit", `already ${n} draft(s) this ISO week (limit ${perWeek})`);

  const sha = specSha256(spec);
  const status = opts.guard_result === "held" ? "held_by_guard" : "drafted";
  const id = randomUUID();
  let strategyId: string | null = opts.strategy_id ?? null;
  if (!strategyId && spec.linked_strategy) {
    const [s] = await db.select({ id: schema.strategies.id }).from(schema.strategies).where(eq(schema.strategies.entityId, entity.id)).orderBy(desc(schema.strategies.createdAt)).limit(1);
    strategyId = s?.id ?? null;
  }
  await db.insert(schema.bounties).values({
    id,
    entityId: entity.id,
    strategyId,
    title: spec.title,
    whyMd: spec.why,
    deliverableMd: spec.deliverable,
    verificationTier: spec.verification_tier,
    evidenceSpec: spec.evidence_spec,
    capUsdc: spec.cap_usdc.toFixed(2),
    claimLimit: spec.claim_limit,
    deadline: spec.deadline,
    twinRefs: spec.twin_refs,
    prediction: spec.prediction,
    status,
    specSha256: sha,
    createdAt: now,
  });
  await appendEntityEvent(db, {
    entity_id: entity.id,
    actor: opts.actor,
    kind: "bounty.drafted",
    payload: { bounty_id: id, status, spec_sha256: sha, verification_tier: spec.verification_tier, cap_usdc: spec.cap_usdc, guard_result: opts.guard_result },
    at: now,
  });
  return { id, status, spec_sha256: sha, spec };
}
