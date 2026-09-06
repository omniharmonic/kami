/**
 * The nightly reputation job (T2.13): the published file must be reproducible
 * byte-for-byte by `recomputeFromInputs` from the same UID inputs.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ReputationFile, recomputeFromInputs } from "@kami/reputation";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { LocalDirPublisher, type Publisher } from "@/lib/publish";
import { directionFromSeries, gatherReputationInputs, runReputation, subjectOf } from "../reputation";
import { makeFakeDeps, type FakeDeps } from "./fakes";
import { seedPayoutChain } from "./seed";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2026-09-06T03:00:00.000Z"); // a Sunday

class MemoryPublisher implements Publisher {
  readonly objects = new Map<string, string>();
  async put(key: string, body: string) {
    this.objects.set(key, body);
    return { etag: `"${key}"` };
  }
  async get(key: string) {
    const body = this.objects.get(key);
    return body ? { body, contentType: "application/json", cacheControl: null, etag: null } : null;
  }
}

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW, env: { KAMI_DATA_BASE_URL: "https://data.example/kami" } });
}, 480_000);
afterEach(async () => {
  await closeTestDb(db);
});

describe("reputation job", () => {
  it("publishes a file recomputeFromInputs reproduces byte-for-byte, and records the run", async () => {
    const s = await seedPayoutChain(db);
    const publisher = new MemoryPublisher();
    const out = await runReputation(db, deps, { publisher, resolveDirection: async () => "up", snapshot: false });

    const published = publisher.objects.get("reputation/2026-09-06.json");
    expect(published).toBe(out.json);
    const parsed = ReputationFile.parse(JSON.parse(published!));
    expect(parsed.function).toBe("reputation/v1");
    expect(parsed.inputs).toEqual([`0x${"1".repeat(64)}`]);
    expect(parsed.root_of_uids).toMatch(/^0x[0-9a-f]{64}$/);

    // the same inputs, recomputed by the public CLI's function
    const inputs = await gatherReputationInputs(db, { now: NOW, resolveDirection: async () => "up" });
    const again = recomputeFromInputs(parsed, inputs.attestations, { passport: inputs.passport, passport_min: inputs.passport_min, predictions: inputs.predictions });
    expect(again.carried).toEqual([]);
    expect(again.identical, again.recomputedJson).toBe(true);
    expect(again.recomputedJson).toBe(out.json);

    const [run] = await db.select().from(schema.reputationRuns);
    expect(run).toMatchObject({ functionVersion: "reputation/v1", rootOfUids: parsed.root_of_uids, scoresUri: "https://data.example/kami/reputation/2026-09-06.json" });
    const scores = await db.select().from(schema.reputationScores);
    expect(scores.length).toBe(parsed.scores.length);
    // the claimant's wallet is the subject; the cross-entity row is stored under "*"
    const subject = subjectOf({ id: s.claimant.id, walletAddress: "0x2222222222222222222222222222222222222222" });
    expect(scores.some((r) => r.subject === subject && r.entityId === "*")).toBe(true);
    expect(scores.some((r) => r.subject === subject && r.entityId === s.entity.id)).toBe(true);
    expect(deps.easFake.attested).toHaveLength(0); // snapshot suppressed
  });

  it("attests a weekly ReputationSnapshot when asked", async () => {
    const s = await seedPayoutChain(db);
    const out = await runReputation(db, deps, { publisher: new MemoryPublisher(), resolveDirection: async () => null, snapshot: true });
    expect(out.snapshot_uids).toHaveLength(1);
    expect(deps.easFake.attested).toHaveLength(1);
    const [att] = await db.select().from(schema.attestations).where(eq(schema.attestations.schema, "ReputationSnapshot"));
    expect(att).toMatchObject({ mode: "onchain", entityId: s.entity.id });
    const [run] = await db.select().from(schema.reputationRuns);
    expect(run!.easUidSnapshot).toBe(out.snapshot_uids[0]!.uid);
  });

  it("excludes an unresolved prediction rather than counting it as a miss", async () => {
    const s = await seedPayoutChain(db, { tier: 1 });
    await db
      .update(schema.bounties)
      .set({ prediction: { place_id: "place/boulder-creek-orodell", property: "discharge", direction: "up", window_end: "2026-09-01T00:00:00Z" } })
      .where(eq(schema.bounties.id, s.bountyId));
    const unresolved = await gatherReputationInputs(db, { now: NOW, resolveDirection: async () => null });
    expect(unresolved.predictions[0]).toMatchObject({ direction: "up", observed_direction: null });
    const resolved = await gatherReputationInputs(db, { now: NOW, resolveDirection: async () => "up" });
    expect(resolved.predictions[0]!.observed_direction).toBe("up");
  });

  it("reads a direction from a twin series, and nothing from a single point", () => {
    const series = { t: ["2026-08-01T00:00:00Z", "2026-08-15T00:00:00Z"], v: [1, 2] };
    expect(directionFromSeries(series, "2026-07-01T00:00:00Z", "2026-09-01T00:00:00Z")).toBe("up");
    expect(directionFromSeries({ t: series.t, v: [2, 1] }, null, "2026-09-01T00:00:00Z")).toBe("down");
    expect(directionFromSeries({ t: ["2026-08-01T00:00:00Z"], v: [1] }, null, "2026-09-01T00:00:00Z")).toBeNull();
    expect(directionFromSeries({ t: series.t, v: [1, null] }, null, "2026-09-01T00:00:00Z")).toBeNull();
  });

  it("writes through the app's LocalDirPublisher too", async () => {
    await seedPayoutChain(db);
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const dir = await mkdtemp(`${tmpdir()}/kami-rep-`);
    const out = await runReputation(db, deps, { publisher: new LocalDirPublisher(dir), resolveDirection: async () => null, snapshot: false });
    expect(await readFile(`${dir}/reputation/2026-09-06.json`, "utf8")).toBe(out.json);
  });
});
