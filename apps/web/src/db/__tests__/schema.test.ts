import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, closeTestDb, seedEntity, seedUser, type TestDb } from "../test-utils";
import * as schema from "../schema";
import { appendEntityEvent, verifyEventChain } from "../events";

let db: TestDb;

/** drizzle wraps driver errors ("Failed query: …") and keeps Postgres' message in `cause`. */
async function expectDbError(p: Promise<unknown>, re: RegExp) {
  let caught: unknown;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  expect(caught, "expected the query to fail").toBeTruthy();
  const err = caught as Error & { cause?: Error };
  const message = `${err.message}\n${err.cause?.message ?? ""}`;
  expect(message).toMatch(re);
}

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await closeTestDb(db);
});

describe("migrations", () => {
  it("apply cleanly and create every Appendix B table", async () => {
    const res = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = (res.rows as { table_name: string }[]).map((r) => r.table_name);
    const expected = [
      "users", "steward_orgs", "entities", "entity_bindings", "souls", "entity_roles", "guardian_invites",
      "need_snapshots", "pulses", "guard_events", "usage_events",
      "strategies", "proposals", "bounties", "claims", "submissions", "evidence_files", "evaluations",
      "safe_proposals", "payouts", "donations", "treasury_transfers", "tax_forms", "donor_reports", "reconciliations",
      "attestations", "reputation_runs", "reputation_scores",
      "chat_sessions", "chat_messages", "commons_notes", "entity_events", "pause_events", "summon_drafts", "config",
      "session", "account", "verification",
    ];
    for (const t of expected) expect(names, `missing table ${t}`).toContain(t);
  });

  it("define every Appendix B enum", async () => {
    const res = await db.execute(sql`select typname from pg_type where typtype = 'e' order by typname`);
    const names = (res.rows as { typname: string }[]).map((r) => r.typname);
    expect(names).toEqual(
      expect.arrayContaining([
        "archetype", "entity_role", "mood", "source_status", "need_state", "proposal_author", "bounty_status",
        "outcome", "payout_rail", "donation_rail", "attestation_mode", "review_state",
      ]),
    );
  });

  it("are idempotent: running the migrator twice is a no-op", async () => {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const { migrationsFolder } = await import("../test-utils");
    await expect(migrate(db, { migrationsFolder })).resolves.toBeUndefined();
  });
});

describe("entities.id check", () => {
  it("rejects an id that is not entity/<slug>", async () => {
    await expectDbError(
      db.insert(schema.entities).values({ id: "foo", slug: "foo", name: "Foo", archetype: "creek" }),
      /entities_id_format/,
    );
  });
  it("accepts entity/<slug>", async () => {
    const row = await seedEntity(db, { slug: "check-ok", name: "Check" });
    expect(row.id).toBe("entity/check-ok");
  });
  it("lowercases email via CHECK (citext stand-in)", async () => {
    await expectDbError(
      db.insert(schema.users).values({ id: "u-upper", email: "Upper@Example.org" }),
      /users_email_lower/,
    );
  });
});

describe("entity_events hash chain", () => {
  it("verifies a fresh chain and detects tampering", async () => {
    await seedEntity(db, { slug: "chain", name: "Chain" });
    const id = "entity/chain";
    await db.transaction(async (tx) => {
      await appendEntityEvent(tx, { entity_id: id, actor: "test", kind: "created", payload: { a: 1 } });
      await appendEntityEvent(tx, { entity_id: id, actor: "test", kind: "paused", payload: { by: ["g1"] } });
      await appendEntityEvent(tx, { entity_id: id, actor: null, kind: "resumed", payload: {} });
    });
    const ok = await verifyEventChain(db, id);
    expect(ok).toEqual({ ok: true, length: 3 });

    // The trigger refuses UPDATE — so tamper as a superuser would have to: disable it first.
    await db.execute(sql`alter table entity_events disable trigger entity_events_no_update_delete`);
    await db.execute(sql`update entity_events set payload = '{"a":2}'::jsonb where entity_id = ${id} and kind = 'created'`);
    await db.execute(sql`alter table entity_events enable trigger entity_events_no_update_delete`);
    const bad = await verifyEventChain(db, id);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("hash_mismatch");
  });

  it("chains prev_hash across rows", async () => {
    await seedEntity(db, { slug: "chain2", name: "Chain2" });
    const a = await appendEntityEvent(db, { entity_id: "entity/chain2", actor: "t", kind: "a", payload: {} });
    const b = await appendEntityEvent(db, { entity_id: "entity/chain2", actor: "t", kind: "b", payload: {} });
    expect(a.prev_hash).toBeNull();
    expect(b.prev_hash).toBe(a.hash);
    expect(b.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is append-only: UPDATE and DELETE are refused by the trigger", async () => {
    await expectDbError(db.execute(sql`update entity_events set actor = 'x'`), /append-only/);
    await expectDbError(db.execute(sql`delete from entity_events`), /append-only/);
  });

  it("is append-only for the kami_app role: UPDATE is a permission error", async () => {
    const roles = await db.execute(sql`select 1 from pg_roles where rolname = 'kami_app'`);
    expect(roles.rows.length).toBe(1);
    const grants = await db.execute(
      sql`select privilege_type from information_schema.role_table_grants where grantee = 'kami_app' and table_name = 'entity_events' order by 1`,
    );
    const privs = (grants.rows as { privilege_type: string }[]).map((r) => r.privilege_type);
    expect(privs).toContain("SELECT");
    expect(privs).toContain("INSERT");
    expect(privs).not.toContain("UPDATE");
    expect(privs).not.toContain("DELETE");
  });
});

describe("evaluator independence trigger", () => {
  async function fixture(prefix: string, opts: { humanProposer?: string } = {}) {
    await seedEntity(db, { slug: prefix, name: prefix });
    const entityId = `entity/${prefix}`;
    await seedUser(db, `${prefix}-claimant`);
    await seedUser(db, `${prefix}-evaluator`);
    if (opts.humanProposer) await seedUser(db, opts.humanProposer);
    let proposalId: string | null = null;
    if (opts.humanProposer) {
      proposalId = `${prefix}-prop`;
      await db.insert(schema.proposals).values({
        id: proposalId, entityId, authorKind: "human", authorId: opts.humanProposer, title: "t", bodyMd: "b",
      });
    }
    await db.insert(schema.bounties).values({
      id: `${prefix}-bounty`, entityId, proposalId, title: "t", whyMd: "w", deliverableMd: "d", verificationTier: 2,
      evidenceSpec: {}, capUsdc: "10.00", twinRefs: ["place/boulder-creek-near-orodell-co"], specSha256: "x",
    });
    await db.insert(schema.claims).values({ id: `${prefix}-claim`, bountyId: `${prefix}-bounty`, userId: `${prefix}-claimant` });
    await db.insert(schema.submissions).values({ id: `${prefix}-sub`, claimId: `${prefix}-claim`, evidenceSummary: {} });
    return { submissionId: `${prefix}-sub` };
  }

  it("rejects an evaluator evaluating their own claim", async () => {
    const { submissionId } = await fixture("self");
    await expectDbError(
      db.insert(schema.evaluations).values({ id: "ev-self", submissionId, evaluatorId: "self-claimant", outcome: "succeeded" }),
      /own claim/,
    );
  });

  it("rejects an evaluator who proposed the bounty", async () => {
    const { submissionId } = await fixture("prop", { humanProposer: "prop-author" });
    await expectDbError(
      db.insert(schema.evaluations).values({ id: "ev-prop", submissionId, evaluatorId: "prop-author", outcome: "succeeded" }),
      /proposed/,
    );
  });

  it("accepts an independent evaluator", async () => {
    const { submissionId } = await fixture("indep", { humanProposer: "indep-author" });
    await expect(
      db.insert(schema.evaluations).values({ id: "ev-ok", submissionId, evaluatorId: "indep-evaluator", outcome: "partial" }),
    ).resolves.toBeTruthy();
  });

  it("rejects a tier outside 1–4", async () => {
    await expectDbError(
      db.insert(schema.bounties).values({
        id: "tier9", entityId: "entity/indep", title: "t", whyMd: "w", deliverableMd: "d", verificationTier: 9,
        evidenceSpec: {}, capUsdc: "1.00", twinRefs: [], specSha256: "x",
      }),
      /verification_tier/,
    );
  });
});
