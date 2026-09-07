/** Request-only dashboard reads. Private snapshots never enter published status caches. */
import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { BindingSchema } from "@kami/binding";
import type { HealthSnapshot } from "@kami/needs";
import { withDb } from "@/db/client";
import * as schema from "@/db/schema";
import { requireVisibleEntity } from "@/lib/entity-access";
import { getStatusCached } from "@/lib/entities";
import { pulseEntrySchema, snapshotSchema, treasurySummarySchema, type PulseEntry, type TreasurySummary } from "@/lib/status";
import { readSafeBalance } from "@/lib/treasury/reads";
import { getTreasuryDeps } from "@/lib/treasury/deps";

/** Authorization runs here as well as in each route; no caller-provided preview flag. */
export async function getVisibleEntityDashboard(slug: string) {
  const visible = await requireVisibleEntity(slug);
  if (!visible.preview) {
    const status = await getStatusCached(slug);
    return { ...visible, status, snapshot: status?.snapshot ?? null, asOf: status?.as_of ?? null, pulses: status?.pulses ?? [], treasury: status?.treasury ?? null };
  }

  const privateSnapshot = await withDb(async (db) => {
    const [row] = await db.select({
      snapshot: schema.needSnapshots.snapshot,
      asOf: schema.needSnapshots.asOf,
      binding: schema.entityBindings.binding,
      version: schema.entityBindings.bindingVersion,
    }).from(schema.entities)
      .innerJoin(schema.entityBindings, and(
        eq(schema.entityBindings.entityId, schema.entities.id),
        eq(schema.entityBindings.bindingVersion, schema.entities.bindingVersion),
      ))
      .innerJoin(schema.needSnapshots, eq(schema.needSnapshots.entityId, schema.entities.id))
      .where(and(
        eq(schema.entities.id, visible.entity.id),
        isNull(schema.entities.consultationDoneAt),
        eq(schema.entityBindings.review, "approved"),
        isNotNull(schema.entityBindings.reviewedAt),
        // Snapshot rows predate binding-version provenance. Reject snapshots from
        // before this approval instead of showing the previous binding's needs.
        gte(schema.needSnapshots.asOf, schema.entityBindings.reviewedAt),
      ))
      .orderBy(desc(schema.needSnapshots.asOf)).limit(1);
    if (!row) return null;
    const binding = BindingSchema.safeParse(row.binding);
    const snapshot = snapshotSchema.safeParse(row.snapshot);
    if (!binding.success || !snapshot.success || binding.data.entity_id !== visible.entity.id
        || binding.data.binding_version !== row.version || snapshot.data.entity_id !== visible.entity.id) return null;
    return { snapshot: snapshot.data as HealthSnapshot, asOf: row.asOf.toISOString() };
  }, null);
  // Separate request-scoped values: never manufacture a public Status for a
  // private being or write private notes into the published status cache.
  const privateJournal = await withDb(async (db) => {
    const [pulseRows, pendingRows] = await Promise.all([
      db.select().from(schema.pulses).where(and(eq(schema.pulses.entityId, visible.entity.id), eq(schema.pulses.guardResult, "pass"))).orderBy(desc(schema.pulses.at)).limit(20),
      db.select({ hash: schema.safeProposals.safeTxHash }).from(schema.safeProposals).where(and(eq(schema.safeProposals.entityId, visible.entity.id), eq(schema.safeProposals.status, "pending"))),
    ]);
    const pulses: PulseEntry[] = pulseRows.flatMap((row) => {
      const parsed = pulseEntrySchema.safeParse({ at: row.at.toISOString(), woke: row.woke, text: row.text, guard_result: row.guardResult, deltas: Array.isArray(row.deltas) ? row.deltas : [] });
      return parsed.success ? [parsed.data] : [];
    });
    let balance: string | null = null;
    if (visible.entity.safe_address) {
      try { balance = (await readSafeBalance(getTreasuryDeps(), visible.entity.safe_address)).balance_usdc; } catch { /* Unknown remains unknown. */ }
    }
    const treasury = treasurySummarySchema.parse({ safe_address: visible.entity.safe_address ?? null, balance_usdc: balance, pending: pendingRows.length });
    return { pulses, treasury };
  }, { pulses: [] as PulseEntry[], treasury: null as TreasurySummary | null });
  return { ...visible, status: null, snapshot: privateSnapshot?.snapshot ?? null, asOf: privateSnapshot?.asOf ?? null, ...privateJournal };
}
