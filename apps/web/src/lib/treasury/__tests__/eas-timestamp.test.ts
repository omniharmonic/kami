/**
 * Nightly `multiTimestamp` (T2.9): every offchain UID goes into one call and
 * the Merkle root recomputes from the UID list alone.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { merkleRootOfUids } from "@kami/reputation";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, seedEntity, type TestDb } from "@/db/test-utils";
import { getConfig } from "@/lib/jobs/common";
import { runEasTimestamp } from "../eas-timestamp";
import { makeFakeDeps, type FakeDeps } from "./fakes";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2026-09-06T03:00:00.000Z");

const uid = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW });
});
afterEach(async () => {
  await closeTestDb(db);
});

async function seedAttestations(entityId: string) {
  await db.insert(schema.attestations).values([
    { uid: uid(3), schema: "ProposalOutcome", mode: "offchain", attester: "0x1", entityId, payload: {} },
    { uid: uid(1), schema: "BountyPosted", mode: "offchain", attester: "0x1", entityId, payload: {} },
    { uid: uid(2), schema: "ProposalOutcome", mode: "offchain", attester: "0x1", entityId, payload: {}, timestampedAt: new Date("2026-09-01T03:00:00Z"), timestampedTx: `0x${"11".repeat(32)}` },
    { uid: uid(4), schema: "BountyCompleted", mode: "onchain", attester: "0x1", entityId, payload: {} },
  ]);
}

describe("eas-timestamp", () => {
  it("timestamps only untimestamped offchain UIDs and the root recomputes from the list", async () => {
    const entity = await seedEntity(db);
    await seedAttestations(entity.id);

    const out = await runEasTimestamp(db, deps);
    expect(out.count).toBe(2);
    expect(out.uids).toEqual([uid(1), uid(3)]); // sorted, deduplicated
    expect(deps.easFake.timestamped).toEqual([[uid(1), uid(3)]]);
    expect(out.merkle_root).toBe(merkleRootOfUids([uid(3), uid(1)]));
    expect(out.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);

    for (const u of [uid(1), uid(3)]) {
      const [row] = await db.select().from(schema.attestations).where(eq(schema.attestations.uid, u));
      expect(row!.timestampedAt?.toISOString()).toBe(NOW.toISOString());
      expect(row!.timestampedTx).toBe(out.tx_hash);
    }
    // the already-timestamped and the onchain rows are untouched
    const [old] = await db.select().from(schema.attestations).where(eq(schema.attestations.uid, uid(2)));
    expect(old!.timestampedTx).toBe(`0x${"11".repeat(32)}`);
    const [onchain] = await db.select().from(schema.attestations).where(eq(schema.attestations.uid, uid(4)));
    expect(onchain!.timestampedAt).toBeNull();

    expect(await getConfig(db, "eas_timestamp.last_run")).toMatchObject({ count: 2, merkle_root: out.merkle_root });
    const events = await db.select().from(schema.entityEvents);
    expect(events.map((e) => e.kind)).toContain("attestation.timestamped");
  });

  it("does nothing when there is nothing to timestamp", async () => {
    await seedEntity(db);
    const out = await runEasTimestamp(db, deps);
    expect(out).toMatchObject({ count: 0, merkle_root: null, tx_hash: null });
    expect(deps.easFake.timestamped).toHaveLength(0);
  });
});
