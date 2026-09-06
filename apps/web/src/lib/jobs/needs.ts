/**
 * The hourly needs job (ADR-E14, plan T1.4). Per non-retired entity:
 *
 *   current approved binding → twin readings per need (readings.ts)
 *   → live layers → `computeSnapshot` (mood in code, hysteresis vs the
 *   previous row) → `need_snapshots` (only when something changed)
 *   → `classifyDeltas` vs the previous → publish `entity/<slug>/status.json`.
 *
 * Idempotent: a re-run whose twin slice is unchanged (same `snapshotHash`)
 * and whose platform facts (paused, gpu_online, mood) are unchanged inserts
 * no row and republishes the same snapshot under a fresh `as_of`.
 */
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { BindingSchema, type Binding } from "@kami/binding";
import { computeSnapshot, snapshotHash, type HealthSnapshot, type NeedName, type NeedSpec } from "@kami/needs";
import type { TwinClient } from "@kami/twin-client";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import type { PulseEntry } from "@/lib/status";
import { deltasSince, hasNotableDelta, type Delta } from "@/lib/deltas";
import { getPublisher, publishStatus, type Publisher } from "@/lib/publish";
import { activeEntities, getConfig, gpuOnline } from "./common";
import { gatherLive, resolveNeedInput, TreeReader, watershedBoxes } from "./readings";
import { getTwinClient } from "./twin";

const NEED_NAMES: readonly NeedName[] = ["flow", "storage", "snow", "water", "air", "drought", "stage", "fire", "alerts"];

export type EntityRow = typeof schema.entities.$inferSelect;
export type SnapshotRow = typeof schema.needSnapshots.$inferSelect;

export type CurrentBinding = { binding: Binding; version: number; sha256: string };

/** The binding `entities.binding_version` points at, if it is approved and well-formed. */
export async function loadCurrentBinding(db: DbOrTx, entity: EntityRow): Promise<CurrentBinding | { error: string }> {
  if (entity.bindingVersion === null) return { error: "no_binding_version" };
  const [row] = await db
    .select()
    .from(schema.entityBindings)
    .where(and(eq(schema.entityBindings.entityId, entity.id), eq(schema.entityBindings.bindingVersion, entity.bindingVersion)))
    .limit(1);
  if (!row) return { error: "binding_row_missing" };
  if (row.review !== "approved") return { error: `binding_${row.review}` };
  const parsed = BindingSchema.safeParse(row.binding);
  if (!parsed.success) return { error: "binding_invalid" };
  return { binding: parsed.data as Binding, version: row.bindingVersion, sha256: row.sha256 };
}

export function specsFromBinding(binding: Binding): NeedSpec[] {
  const names = new Map(binding.members.map((m) => [m.id, m.name] as const));
  const out: NeedSpec[] = [];
  for (const n of binding.needs) {
    if (!NEED_NAMES.includes(n.need as NeedName)) continue;
    const label = n.places[0] ? names.get(n.places[0]) : undefined;
    out.push({
      need: n.need as NeedName,
      property: n.property,
      places: n.places,
      agg: n.agg,
      ...(typeof n.weight === "number" ? { weight: n.weight } : {}),
      ...(label ? { place_label: label } : {}),
    });
  }
  return out;
}

export async function latestSnapshotRow(db: DbOrTx, entityId: string): Promise<SnapshotRow | null> {
  const [row] = await db.select().from(schema.needSnapshots).where(eq(schema.needSnapshots.entityId, entityId)).orderBy(desc(schema.needSnapshots.asOf)).limit(1);
  return row ?? null;
}

/** A `BountyCompleted` in the last 24 h: an executed payout for one of the entity's bounties, or an indexed attestation. */
export async function bountyCompletedIn24h(db: DbOrTx, entityId: string, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - 24 * 3600_000);
  const [p] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.payouts)
    .innerJoin(schema.submissions, eq(schema.submissions.id, schema.payouts.submissionId))
    .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
    .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
    .where(and(eq(schema.bounties.entityId, entityId), isNotNull(schema.payouts.executedAt), gte(schema.payouts.executedAt, since)));
  if ((p?.n ?? 0) > 0) return true;
  const [a] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.attestations)
    .where(and(eq(schema.attestations.entityId, entityId), eq(schema.attestations.schema, "BountyCompleted"), gte(schema.attestations.createdAt, since)));
  return (a?.n ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// status.json
// ---------------------------------------------------------------------------

export type SupersededNote = { need: string; id: string; state: "stale" | "missing"; successor: string | null; line: string };

/** The templated line (architecture §3; skill templates.md) — never a model choice. */
export const SUPERSEDED_LINE = "one of my gauges was retired; my stewards are updating my body";

export type StatusFile = {
  schema_version: "1.0";
  entity_id: string;
  entity: { name: string; archetype: EntityRow["archetype"]; anchor: string | null };
  as_of: string;
  snapshot: HealthSnapshot;
  snapshot_id: number | null;
  snapshot_hash: string;
  binding_version: number | null;
  pulses: PulseEntry[];
  board: {
    open: number;
    claimed: number;
    in_review: number;
    paid: number;
    human_proposals: number;
    open_bounties: Array<{ id: string; title: string; cap_usdc: string; verification_tier: number; deadline: string | null; claim_limit: number }>;
  };
  treasury: {
    safe_address: string | null;
    balance_usdc: string | null;
    pending: number;
    payouts_total_usdc: string | null;
    last_report_month: string | null;
    payouts: Array<{ id: string; amount_usdc: string; executed_at: string | null; tx_hash: string | null; eas_uid_completed: string | null }>;
  };
  event_chain_head: string | null;
  superseded: SupersededNote[];
};

type BindingFinding = { id: string; state: "stale" | "missing"; successor?: string; needs: string[] };

export async function buildStatusFile(
  db: DbOrTx,
  entity: EntityRow,
  snapshot: HealthSnapshot,
  opts: { now: Date; snapshotId: number | null; snapshotHash: string; anchor: string | null; bindingVersion: number | null },
): Promise<StatusFile> {
  const [pulseRows, bountyCounts, humanProposals, openBounties, pendingSafe, payoutRows, payoutTotal, lastReport, chainHead, findings] = await Promise.all([
    db.select().from(schema.pulses).where(eq(schema.pulses.entityId, entity.id)).orderBy(desc(schema.pulses.at)).limit(20),
    db
      .select({ status: schema.bounties.status, n: sql<number>`count(*)::int` })
      .from(schema.bounties)
      .where(eq(schema.bounties.entityId, entity.id))
      .groupBy(schema.bounties.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.proposals)
      .where(and(eq(schema.proposals.entityId, entity.id), eq(schema.proposals.authorKind, "human"), eq(schema.proposals.status, "open"))),
    db
      .select()
      .from(schema.bounties)
      .where(and(eq(schema.bounties.entityId, entity.id), inArray(schema.bounties.status, ["open", "claimed", "in_review"])))
      .orderBy(desc(schema.bounties.createdAt))
      .limit(10),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.safeProposals)
      .where(and(eq(schema.safeProposals.entityId, entity.id), eq(schema.safeProposals.status, "pending"))),
    db
      .select({ id: schema.payouts.id, amount: schema.payouts.amountUsdc, executedAt: schema.payouts.executedAt, txHash: schema.payouts.txHash, uid: schema.payouts.easUidCompleted })
      .from(schema.payouts)
      .innerJoin(schema.submissions, eq(schema.submissions.id, schema.payouts.submissionId))
      .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
      .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
      .where(and(eq(schema.bounties.entityId, entity.id), isNotNull(schema.payouts.executedAt)))
      .orderBy(desc(schema.payouts.executedAt))
      .limit(10),
    db
      .select({ total: sql<string | null>`sum(${schema.payouts.amountUsdc})::text` })
      .from(schema.payouts)
      .innerJoin(schema.submissions, eq(schema.submissions.id, schema.payouts.submissionId))
      .innerJoin(schema.claims, eq(schema.claims.id, schema.submissions.claimId))
      .innerJoin(schema.bounties, eq(schema.bounties.id, schema.claims.bountyId))
      .where(and(eq(schema.bounties.entityId, entity.id), isNotNull(schema.payouts.executedAt))),
    db
      .select({ month: schema.donorReports.month })
      .from(schema.donorReports)
      .where(and(eq(schema.donorReports.entityId, entity.id), isNotNull(schema.donorReports.sentAt)))
      .orderBy(desc(schema.donorReports.month))
      .limit(1),
    getConfig<{ hash?: string | null }>(db, `event_chain_head.${entity.slug}`),
    getConfig<BindingFinding[]>(db, `binding_findings.${entity.slug}`),
  ]);

  const counts: Record<string, number> = {};
  for (const r of bountyCounts) counts[r.status] = r.n;

  const superseded: SupersededNote[] = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    for (const need of f.needs ?? []) {
      superseded.push({ need, id: f.id, state: f.state, successor: f.successor ?? null, line: SUPERSEDED_LINE });
    }
  }

  return {
    schema_version: "1.0",
    entity_id: entity.id,
    entity: { name: entity.name, archetype: entity.archetype, anchor: opts.anchor },
    as_of: opts.now.toISOString(),
    snapshot,
    snapshot_id: opts.snapshotId,
    snapshot_hash: opts.snapshotHash,
    binding_version: opts.bindingVersion,
    pulses: pulseRows.map((p) => ({
      at: p.at.toISOString(),
      woke: p.woke,
      text: p.text,
      guard_result: (p.guardResult as PulseEntry["guard_result"]) ?? null,
      deltas: Array.isArray(p.deltas) ? (p.deltas as Delta[]) : [],
    })),
    board: {
      open: counts["open"] ?? 0,
      claimed: counts["claimed"] ?? 0,
      in_review: counts["in_review"] ?? 0,
      paid: counts["paid"] ?? 0,
      human_proposals: humanProposals[0]?.n ?? 0,
      open_bounties: openBounties.map((b) => ({ id: b.id, title: b.title, cap_usdc: b.capUsdc, verification_tier: b.verificationTier, deadline: b.deadline, claim_limit: b.claimLimit })),
    },
    treasury: {
      safe_address: entity.safeAddress,
      balance_usdc: null,
      pending: pendingSafe[0]?.n ?? 0,
      payouts_total_usdc: payoutTotal[0]?.total ?? null,
      last_report_month: lastReport[0]?.month ?? null,
      payouts: payoutRows.map((r) => ({ id: r.id, amount_usdc: r.amount, executed_at: r.executedAt?.toISOString() ?? null, tx_hash: r.txHash, eas_uid_completed: r.uid })),
    },
    event_chain_head: typeof chainHead?.hash === "string" ? chainHead.hash : null,
    superseded,
  };
}

// ---------------------------------------------------------------------------
// the job
// ---------------------------------------------------------------------------

export type EntityNeedsResult = {
  slug: string;
  status: "published" | "skipped" | "error";
  reason?: string;
  new_snapshot?: boolean;
  snapshot_id?: number | null;
  snapshot_hash?: string;
  mood?: HealthSnapshot["mood"];
  stale_driving?: boolean;
  deltas?: number;
  notable?: boolean;
  twin_unreachable?: string[];
  published?: { key: string; etag: string; bytes: number };
};

export type NeedsJobOptions = {
  db: DbOrTx;
  twin?: TwinClient;
  publisher?: Publisher;
  now?: Date;
  /** run for one entity only */
  slug?: string;
  /** override the heartbeat check (tests) */
  gpuOnline?: boolean;
};

export async function runNeedsJob(opts: NeedsJobOptions): Promise<{ as_of: string; results: EntityNeedsResult[] }> {
  const now = opts.now ?? new Date();
  const twin = opts.twin ?? getTwinClient();
  const publisher = opts.publisher ?? getPublisher();
  const entities = await activeEntities(opts.db, opts.slug);
  const gpu = opts.gpuOnline ?? (await gpuOnline(opts.db, now));
  const results: EntityNeedsResult[] = [];
  for (const entity of entities) {
    try {
      results.push(await runEntity({ db: opts.db, twin, publisher, now, entity, gpu }));
    } catch (err) {
      results.push({ slug: entity.slug, status: "error", reason: (err as Error).message });
    }
  }
  return { as_of: now.toISOString(), results };
}

async function runEntity(a: { db: DbOrTx; twin: TwinClient; publisher: Publisher; now: Date; entity: EntityRow; gpu: boolean }): Promise<EntityNeedsResult> {
  const { db, entity, now } = a;
  const current = await loadCurrentBinding(db, entity);
  if ("error" in current) return { slug: entity.slug, status: "skipped", reason: current.error };
  const { binding } = current;

  const reader = new TreeReader(a.twin, now.getTime());
  const specs = specsFromBinding(binding);
  const [ugc, bounty, previous, snowline] = await Promise.all([
    getConfig<string[]>(db, `entity_ugc.${entity.slug}`),
    bountyCompletedIn24h(db, entity.id, now),
    latestSnapshotRow(db, entity.id),
    reader.snowlineM(),
  ]);
  const live = await gatherLive(reader, binding, { ugcZones: Array.isArray(ugc) ? ugc : [], bountyCompletedIn24h: bounty });
  const boxes = await watershedBoxes(reader, binding);

  const readings: Partial<Record<NeedName, Awaited<ReturnType<typeof resolveNeedInput>>>> = {};
  for (const need of binding.needs) {
    if (!NEED_NAMES.includes(need.need as NeedName)) continue;
    readings[need.need as NeedName] = await resolveNeedInput(reader, need, boxes);
  }

  const prevSnapshot = previous ? (previous.snapshot as HealthSnapshot) : null;
  const snapshot = computeSnapshot(entity.id, specs, readings, live, {
    now,
    previous_snapshots: prevSnapshot ? [prevSnapshot] : [],
    gpu_online: a.gpu,
    paused: entity.pausedAt !== null,
    cosmetics: (entity.cosmetics as Record<string, number>) ?? {},
    snowline_m: snowline,
  });
  const hash = snapshotHash(snapshot);

  const unchanged =
    previous !== null &&
    prevSnapshot !== null &&
    previous.snapshotHash === hash &&
    prevSnapshot.mood === snapshot.mood &&
    prevSnapshot.paused === snapshot.paused &&
    prevSnapshot.gpu_online === snapshot.gpu_online;

  let snapshotId: number | null = previous?.id ?? null;
  let published: HealthSnapshot = unchanged && prevSnapshot ? prevSnapshot : snapshot;
  const deltas = unchanged ? [] : deltasSince(prevSnapshot, snapshot);

  if (!unchanged) {
    const [row] = await db
      .insert(schema.needSnapshots)
      .values({ entityId: entity.id, asOf: now, snapshot, snapshotHash: hash, mood: snapshot.mood, staleDriving: snapshot.stale_driving })
      .onConflictDoNothing({ target: [schema.needSnapshots.entityId, schema.needSnapshots.asOf] })
      .returning();
    if (row) snapshotId = row.id;
    else {
      const again = await latestSnapshotRow(db, entity.id);
      snapshotId = again?.id ?? null;
      published = (again?.snapshot as HealthSnapshot | undefined) ?? snapshot;
    }
  }

  const file = await buildStatusFile(db, entity, published, {
    now,
    snapshotId,
    snapshotHash: unchanged ? previous!.snapshotHash : hash,
    anchor: binding.anchor,
    bindingVersion: current.version,
  });
  const out = await publishStatus(entity.slug, file, a.publisher);
  return {
    slug: entity.slug,
    status: "published",
    new_snapshot: !unchanged,
    snapshot_id: snapshotId,
    snapshot_hash: file.snapshot_hash,
    mood: published.mood,
    stale_driving: published.stale_driving,
    deltas: deltas.length,
    notable: hasNotableDelta(deltas),
    twin_unreachable: reader.unreachable,
    published: out,
  };
}
