/**
 * Nightly: every offchain attestation not yet timestamped → one Merkle root →
 * one `EAS.multiTimestamp(uids)` by the attester (ADR-E06, §8.2; *verify* #9).
 * The root is recomputable from the UID list alone (`merkleRootOfUids`).
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Hex } from "viem";
import type { Db } from "@/db/events";
import { appendEntityEvent } from "@/db/events";
import * as schema from "@/db/schema";
import { setConfig } from "@/lib/jobs/common";
import { timestampBatch } from "@/lib/signing/attester";
import type { TreasuryDeps } from "./deps";

export type TimestampResult = { count: number; uids: Hex[]; merkle_root: Hex | null; tx_hash: Hex | null; entities: string[] };

export async function runEasTimestamp(db: Db, deps: TreasuryDeps): Promise<TimestampResult> {
  const rows = await db
    .select({ uid: schema.attestations.uid, entityId: schema.attestations.entityId })
    .from(schema.attestations)
    .where(and(eq(schema.attestations.mode, "offchain"), isNull(schema.attestations.timestampedAt), isNull(schema.attestations.revokedAt)));
  const valid = rows.filter((r) => /^0x[0-9a-fA-F]{64}$/.test(r.uid));
  if (valid.length === 0) return { count: 0, uids: [], merkle_root: null, tx_hash: null, entities: [] };

  const r = await timestampBatch(deps, valid.map((v) => v.uid));
  const now = deps.now();
  const marker = r.txHash ?? (`merkle:${r.merkleRoot}` as const);
  const entities = [...new Set(valid.map((v) => v.entityId).filter((e): e is string => Boolean(e)))];
  await db.transaction(async (tx) => {
    for (const uid of r.uids) {
      await tx.update(schema.attestations).set({ timestampedTx: marker, timestampedAt: now }).where(eq(schema.attestations.uid, uid));
    }
    for (const entityId of entities) {
      await appendEntityEvent(tx, {
        entity_id: entityId,
        actor: "attester",
        kind: "attestation.timestamped",
        payload: { count: valid.filter((v) => v.entityId === entityId).length, merkle_root: r.merkleRoot, tx_hash: r.txHash },
        at: now,
      });
    }
  });
  await setConfig(db, "eas_timestamp.last_run", { at: now.toISOString(), count: r.uids.length, merkle_root: r.merkleRoot, tx_hash: r.txHash }, now);
  return { count: r.uids.length, uids: r.uids, merkle_root: r.merkleRoot, tx_hash: r.txHash, entities };
}
