import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { listEntityEvents, verifyEventChain } from "@/db/events";
import {
  approveBounty,
  assertTransition,
  canTransition,
  createBountyDraft,
  expireBounties,
  holdByGuard,
  markBountyPaid,
  parseBountySpec,
  specSha256,
  TRANSITIONS,
  withdrawBounty,
} from "../bounties";
import { bountyHashOf } from "@kami/reputation";
import { canonicalSpec } from "../bounties";
import { closeTestDb, createTestDb, openBounty, seedWorld, setConfig, specFor, type TestDb, type World } from "./helpers";

let db: TestDb;
let w: World;

beforeAll(async () => {
  db = await createTestDb();
  w = await seedWorld(db);
});
afterAll(async () => {
  await closeTestDb(db);
});

describe("the §7.6 bounty spec", () => {
  it("refuses a tier-1 bounty with no prediction", () => {
    expect(() => parseBountySpec(specFor(w.entityId, { verification_tier: 1, prediction: null }))).toThrow(/tier1_prediction_required/);
  });

  it("accepts a tier-1 bounty carrying place, property, direction and window", () => {
    const spec = parseBountySpec(
      specFor(w.entityId, {
        verification_tier: 1,
        prediction: { place_id: "place/boulder-creek-near-orodell-co", property: "discharge", direction: "up", window_end: "2026-12-01" },
      }),
    );
    expect(spec.prediction?.direction).toBe("up");
  });

  it("refuses a spec whose entity id is not entity/<slug>", () => {
    expect(() => parseBountySpec(specFor("boulder-creek"))).toThrow(/invalid_spec/);
  });

  it("hashes canonically: key order and whitespace do not change spec_sha256", () => {
    const a = parseBountySpec(specFor(w.entityId));
    const b = parseBountySpec({ ...specFor(w.entityId), title: specFor(w.entityId).title });
    expect(specSha256(a)).toBe(specSha256(b));
    // the same canonical bytes the EAS bountyHash uses
    expect(bountyHashOf(canonicalSpec(a))).toBe(`0x${specSha256(a)}`);
  });

  it("changes spec_sha256 when a field changes", () => {
    const a = parseBountySpec(specFor(w.entityId));
    const b = parseBountySpec(specFor(w.entityId, { cap_usdc: 41 }));
    expect(specSha256(a)).not.toBe(specSha256(b));
  });
});

describe("the state machine", () => {
  it("allows only the Appendix A.4 transitions", () => {
    expect(canTransition("drafted", "open")).toBe(true);
    expect(canTransition("open", "claimed")).toBe(true);
    expect(canTransition("claimed", "in_review")).toBe(true);
    expect(canTransition("in_review", "paid")).toBe(true);
    expect(canTransition("in_review", "deferred")).toBe(true);
    expect(canTransition("drafted", "claimed")).toBe(false);
    expect(canTransition("open", "paid")).toBe(false);
    expect(canTransition("paid", "withdrawn")).toBe(false);
    expect(TRANSITIONS.expired).toEqual([]);
  });

  it("throws invalid_transition rather than writing an impossible state", () => {
    expect(() => assertTransition("paid", "open")).toThrow(/invalid_transition/);
  });

  it("refuses to withdraw a paid bounty", async () => {
    const b = await openBounty(w);
    await db.update(schema.bounties).set({ status: "paid" }).where(eq(schema.bounties.id, b.id));
    await expect(withdrawBounty(db, b.id, w.guardianA)).rejects.toThrow(/invalid_transition/);
  });

  it("writes an entity_event for every transition and keeps the hash chain intact", async () => {
    const b = await openBounty(w);
    const events = (await listEntityEvents(db, w.entityId)).filter((e) => (e.payload as { bounty_id?: string }).bounty_id === b.id);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["bounty_drafted", "bounty_approved", "bounty_open"]));
    expect(await verifyEventChain(db, w.entityId)).toMatchObject({ ok: true });
  });
});

describe("guardian approval (T2.7)", () => {
  it("opens a draft on one approval by default and records the approver", async () => {
    const draft = await createBountyDraft(db, specFor(w.entityId), { actor: null });
    const res = await approveBounty(db, draft.id, w.guardianA);
    expect(res.opened).toBe(true);
    expect(res.required).toBe(1);
    expect(res.bounty.status).toBe("open");
    expect(res.bounty.approvedBy).toBe(w.guardianA);
  });

  it("refuses an edit to entity_id or twin_refs (PRD §7.6)", async () => {
    const draft = await createBountyDraft(db, specFor(w.entityId), { actor: null });
    await expect(approveBounty(db, draft.id, w.guardianA, { entity_id: "entity/somewhere-else" })).rejects.toThrow(/immutable_field/);
    await expect(approveBounty(db, draft.id, w.guardianA, { twin_refs: ["place/elsewhere"] })).rejects.toThrow(/immutable_field/);
    const [row] = await db.select().from(schema.bounties).where(eq(schema.bounties.id, draft.id));
    expect(row!.entityId).toBe(w.entityId);
    expect(row!.status).toBe("drafted");
  });

  it("accepts an edit to any other field and recomputes spec_sha256", async () => {
    const draft = await createBountyDraft(db, specFor(w.entityId), { actor: null });
    const before = draft.specSha256;
    const res = await approveBounty(db, draft.id, w.guardianA, { cap_usdc: 25, evidence_spec: { min_photos: 6 } });
    expect(res.spec_sha256).not.toBe(before);
    expect(res.edited_fields).toEqual(expect.arrayContaining(["cap_usdc", "evidence_spec"]));
    expect(res.bounty.capUsdc).toBe("25.00");
    expect((res.bounty.evidenceSpec as { min_photos: number; gps_within_m: number }).min_photos).toBe(6);
    // untouched clauses of the evidence spec survive the merge
    expect((res.bounty.evidenceSpec as { gps_within_m: number }).gps_within_m).toBe(50);
  });

  it("refuses an edit that would make a tier-1 bounty predictionless", async () => {
    const draft = await createBountyDraft(db, specFor(w.entityId), { actor: null });
    await expect(approveBounty(db, draft.id, w.guardianA, { verification_tier: 1 })).rejects.toThrow(/tier1_prediction_required/);
  });

  it("refuses an unknown field", async () => {
    const draft = await createBountyDraft(db, specFor(w.entityId), { actor: null });
    await expect(approveBounty(db, draft.id, w.guardianA, { safe_address: "0x1" })).rejects.toThrow(/invalid_spec/);
  });

  it("needs two distinct guardians when config.bounty_approvals_required is 2, and an edit restarts the count", async () => {
    await setConfig(db, "bounty_approvals_required", 2);
    try {
      const draft = await createBountyDraft(db, specFor(w.entityId), { actor: null });
      const first = await approveBounty(db, draft.id, w.guardianA);
      expect(first.opened).toBe(false);
      expect(first.approvals).toBe(1);
      // the same guardian twice is still one approval
      expect((await approveBounty(db, draft.id, w.guardianA)).opened).toBe(false);
      // an edit by the second guardian changes the hash, so the count starts again
      const edited = await approveBounty(db, draft.id, w.guardianB, { cap_usdc: 30 });
      expect(edited.opened).toBe(false);
      expect(edited.approvals).toBe(1);
      const second = await approveBounty(db, draft.id, w.guardianA);
      expect(second.opened).toBe(true);
      expect(second.bounty.status).toBe("open");
    } finally {
      await setConfig(db, "bounty_approvals_required", 1);
    }
  });

  it("does not revive old approvals when a spec changes A → B → A at the same timestamp", async () => {
    await setConfig(db, "bounty_approvals_required", 2);
    try {
      const now = new Date("2026-09-07T12:00:00Z");
      const spec = specFor(w.entityId);
      const draft = await createBountyDraft(db, spec, { actor: null, now });
      const original = await approveBounty(db, draft.id, w.guardianA, {}, { now });
      expect(original.approvals).toBe(1);
      await approveBounty(db, draft.id, w.guardianB, { cap_usdc: spec.cap_usdc + 1 }, { now });
      const restored = await approveBounty(db, draft.id, w.guardianB, { cap_usdc: spec.cap_usdc }, { now });
      expect(restored.spec_sha256).toBe(original.spec_sha256);
      expect(restored.approvals).toBe(1);
      expect(restored.opened).toBe(false);
      // Repeated confirmation by B is still one current-revision approval.
      expect((await approveBounty(db, draft.id, w.guardianB, {}, { now })).approvals).toBe(1);
      const renewed = await approveBounty(db, draft.id, w.guardianA, {}, { now });
      expect(renewed.approvals).toBe(2);
      expect(renewed.opened).toBe(true);
    } finally {
      await setConfig(db, "bounty_approvals_required", 1);
    }
  });

  it("does not reset approvals for an edit that leaves the spec unchanged", async () => {
    await setConfig(db, "bounty_approvals_required", 2);
    try {
      const spec = specFor(w.entityId);
      const draft = await createBountyDraft(db, spec, { actor: null });
      await approveBounty(db, draft.id, w.guardianA);
      const second = await approveBounty(db, draft.id, w.guardianB, { cap_usdc: spec.cap_usdc });
      expect(second.edited_fields).toEqual([]);
      expect(second.approvals).toBe(2);
      expect(second.opened).toBe(true);
    } finally {
      await setConfig(db, "bounty_approvals_required", 1);
    }
  });

  it("refuses approval by someone who is not a guardian", async () => {
    const draft = await createBountyDraft(db, specFor(w.entityId), { actor: null });
    await expect(approveBounty(db, draft.id, w.contributor)).rejects.toThrow(/forbidden/);
  });

  it("refuses approval while the entity is paused (ADR-E12)", async () => {
    const draft = await createBountyDraft(db, specFor(w.entityId), { actor: null });
    await db.update(schema.entities).set({ pausedAt: new Date() }).where(eq(schema.entities.id, w.entityId));
    await expect(approveBounty(db, draft.id, w.guardianA)).rejects.toThrow(/paused/);
    await db.update(schema.entities).set({ pausedAt: null }).where(eq(schema.entities.id, w.entityId));
  });

  it("lets a guard-held draft be edited and approved", async () => {
    const draft = await createBountyDraft(db, specFor(w.entityId), { actor: null });
    const held = await holdByGuard(db, draft.id, "a number did not match a reading");
    expect(held.status).toBe("held_by_guard");
    expect((await approveBounty(db, draft.id, w.guardianA, { why: "Flow is at a seven-day low." })).bounty.status).toBe("open");
  });
});

describe("withdraw, expire and pay", () => {
  it("withdraws an open bounty and releases its claims", async () => {
    const b = await openBounty(w);
    await db.insert(schema.claims).values({ id: `claim_w_${b.id}`, bountyId: b.id, userId: w.contributor });
    const out = await withdrawBounty(db, b.id, w.guardianA, "no longer needed");
    expect(out.status).toBe("withdrawn");
    const [claim] = await db.select().from(schema.claims).where(eq(schema.claims.id, `claim_w_${b.id}`));
    expect(claim!.releasedAt).not.toBeNull();
  });

  it("expires bounties whose deadline has passed and leaves the rest alone", async () => {
    const past = await openBounty(w, { deadline: "2020-01-01" });
    const future = await openBounty(w, { deadline: "2099-01-01" });
    const expired = await expireBounties(db, { entity_id: w.entityId, today: "2026-09-06" });
    expect(expired).toContain(past.id);
    expect(expired).not.toContain(future.id);
    const [row] = await db.select().from(schema.bounties).where(eq(schema.bounties.id, past.id));
    expect(row!.status).toBe("expired");
  });

  it("marks paid only through the treasury entry point", async () => {
    const b = await openBounty(w);
    await db.update(schema.bounties).set({ status: "in_review" }).where(eq(schema.bounties.id, b.id));
    const paid = await markBountyPaid(db, b.id, null, { payout_id: "payout_1", safe_tx_hash: "0xabc" });
    expect(paid.status).toBe("paid");
  });

  it("refuses a claim-side transition on a withdrawn bounty", async () => {
    const b = await openBounty(w);
    await withdrawBounty(db, b.id, w.guardianA);
    await expect(markBountyPaid(db, b.id, null, { payout_id: "x" })).rejects.toThrow(/invalid_transition/);
  });
});
