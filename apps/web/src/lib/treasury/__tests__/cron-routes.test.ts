/**
 * The four money crons: `CRON_SECRET` auth, and each route wired to its job.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { setDbForTests } from "@/db/client";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import { setPublisherForTests, type Publisher } from "@/lib/publish";
import { setTreasuryDepsForTests } from "../deps";
import { makeFakeDeps, RECIPIENT, type FakeDeps } from "./fakes";
import { seedPayoutChain } from "./seed";
import { GET as safePoll } from "@/app/api/cron/safe-poll/route";
import { GET as reconcile } from "@/app/api/cron/reconcile/route";
import { GET as easTimestamp } from "@/app/api/cron/eas-timestamp/route";
import { GET as reputation } from "@/app/api/cron/reputation/route";

let db: TestDb;
let deps: FakeDeps;
const NOW = new Date("2026-09-06T03:00:00.000Z");

class MemoryPublisher implements Publisher {
  readonly objects = new Map<string, string>();
  async put(key: string, body: string) {
    this.objects.set(key, body);
    return { etag: "x" };
  }
  async get(key: string) {
    const body = this.objects.get(key);
    return body ? { body, contentType: null, cacheControl: null, etag: null } : null;
  }
}

const req = (path: string, secret?: string) =>
  new Request(`http://localhost:3000${path}`, secret ? { headers: { authorization: `Bearer ${secret}` } } : {});

beforeEach(async () => {
  db = await createTestDb();
  deps = makeFakeDeps({ now: NOW });
  setDbForTests(db as never);
  setTreasuryDepsForTests(deps);
  setPublisherForTests(new MemoryPublisher());
}, 480_000);
afterEach(async () => {
  setDbForTests(null);
  setTreasuryDepsForTests(null);
  setPublisherForTests(null);
  delete process.env.CRON_SECRET;
  await closeTestDb(db);
});

describe("money crons", () => {
  it("refuse a wrong CRON_SECRET", async () => {
    process.env.CRON_SECRET = "s3cret";
    for (const route of [safePoll, reconcile, easTimestamp, reputation]) {
      expect((await route(req("/api/cron/x", "wrong"))).status).toBe(401);
      expect((await route(req("/api/cron/x"))).status).toBe(401);
    }
  });

  it("safe-poll executes a two-signature proposal", async () => {
    process.env.CRON_SECRET = "s3cret";
    const s = await seedPayoutChain(db);
    const hash = deps.apiKitFake.seedPending({ to: RECIPIENT, amountUsdc6: 25_000_000n, nonce: 7, confirmations: 2, usdc: deps.chain.usdc.address });
    await db.insert(schema.safeProposals).values({ safeTxHash: hash, entityId: s.entity.id, submissionId: s.submissionId, nonce: 7, toAddress: RECIPIENT, amountUsdc: "25.00", proposedAt: NOW, confirmations: 2, status: "pending" });
    const res = await safePoll(req("/api/cron/safe-poll", "s3cret"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { executed: unknown[]; checked: number };
    expect(body.checked).toBe(1);
    expect(body.executed).toHaveLength(1);
  });

  it("reconcile answers 409 and names the blocked entity on a mismatch", async () => {
    const s = await seedPayoutChain(db);
    await db.insert(schema.donations).values({ id: "d1", entityId: s.entity.id, rail: "usdc_direct", net: "100.00", gross: "100.00", fee: "0.00", chainTxHash: `0x${"aa".repeat(32)}` });
    deps.publicClientFake.usdcBalance = 0n;
    const res = await reconcile(req("/api/cron/reconcile"));
    expect(res.status).toBe(409);
    expect((await res.json()) as { blocked: string[] }).toMatchObject({ blocked: [s.slug] });
  });

  it("eas-timestamp and reputation report their work", async () => {
    const s = await seedPayoutChain(db);
    await db.insert(schema.attestations).values({ uid: `0x${"5".repeat(64)}`, schema: "ProposalOutcome", mode: "offchain", attester: "0x1", entityId: s.entity.id, payload: {} });

    const t = await easTimestamp(req("/api/cron/eas-timestamp"));
    expect(t.status).toBe(200);
    expect(await t.json()).toMatchObject({ job: "eas-timestamp", count: 1 });

    const r = await reputation(req("/api/cron/reputation?snapshot=0"));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { key: string; inputs: number; snapshots: unknown[] };
    expect(body.key).toBe("reputation/2026-09-06.json");
    expect(body.inputs).toBe(1);
    expect(body.snapshots).toEqual([]);
  });
});
