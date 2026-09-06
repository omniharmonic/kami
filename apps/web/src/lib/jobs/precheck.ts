/**
 * The pulse precheck (architecture §5.3, A.2): has the entity's snapshot
 * changed since the last pulse? "Changed" compares `snapshotHash` — which
 * excludes `as_of` and `staleness_s` on purpose — of the latest
 * `need_snapshots` row with the hash of the snapshot the last pulse row
 * points at. No pulse yet → changed whenever a snapshot exists.
 */
import { desc, eq, isNotNull, and } from "drizzle-orm";
import type { HealthSnapshot } from "@kami/needs";
import type { DbOrTx } from "@/db/events";
import * as schema from "@/db/schema";
import { latestSnapshotRow, type SnapshotRow } from "./needs";

export type PrecheckResult = {
  changed: boolean;
  snapshot_id: number | null;
  snapshot_hash: string | null;
  as_of: string | null;
  last_pulse: { id: number; at: string; snapshot_id: number | null; snapshot_hash: string | null } | null;
};

/** The snapshot row the most recent pulse was written against, if any. */
export async function snapshotAtLastPulse(db: DbOrTx, entityId: string): Promise<{ pulse: typeof schema.pulses.$inferSelect; snapshot: SnapshotRow | null } | null> {
  const [pulse] = await db
    .select()
    .from(schema.pulses)
    .where(and(eq(schema.pulses.entityId, entityId), isNotNull(schema.pulses.snapshotId)))
    .orderBy(desc(schema.pulses.at), desc(schema.pulses.id))
    .limit(1);
  if (!pulse) return null;
  const [snap] = pulse.snapshotId === null ? [] : await db.select().from(schema.needSnapshots).where(eq(schema.needSnapshots.id, pulse.snapshotId)).limit(1);
  return { pulse, snapshot: snap ?? null };
}

export async function precheck(db: DbOrTx, entityId: string): Promise<PrecheckResult> {
  const latest = await latestSnapshotRow(db, entityId);
  const last = await snapshotAtLastPulse(db, entityId);
  const lastHash = last?.snapshot?.snapshotHash ?? null;
  return {
    changed: latest !== null && latest.snapshotHash !== lastHash,
    snapshot_id: latest?.id ?? null,
    snapshot_hash: latest?.snapshotHash ?? null,
    as_of: latest?.asOf.toISOString() ?? null,
    last_pulse: last ? { id: last.pulse.id, at: last.pulse.at.toISOString(), snapshot_id: last.pulse.snapshotId, snapshot_hash: lastHash } : null,
  };
}

/** The baseline for `deltas[]`: the last pulse's snapshot, else the snapshot before the latest. */
export async function baselineSnapshot(db: DbOrTx, entityId: string, latest: SnapshotRow | null): Promise<HealthSnapshot | null> {
  const last = await snapshotAtLastPulse(db, entityId);
  if (last?.snapshot && (!latest || last.snapshot.id !== latest.id)) return last.snapshot.snapshot as HealthSnapshot;
  if (!latest) return null;
  const rows = await db.select().from(schema.needSnapshots).where(eq(schema.needSnapshots.entityId, entityId)).orderBy(desc(schema.needSnapshots.asOf)).limit(2);
  const prev = rows.find((r) => r.id !== latest.id);
  return prev ? (prev.snapshot as HealthSnapshot) : null;
}
