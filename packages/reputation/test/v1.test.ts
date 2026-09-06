import { beforeEach, describe, expect, it } from "vitest";
import {
  TIER_WEIGHT,
  computeEntityScores,
  computeReputation,
  decay,
  merkleRootOfUids,
  round,
  stakeWeight,
  wilsonLowerBound,
} from "../src/v1.js";
import type { Score } from "../src/types.js";
import { NOW, agedIso, att, prediction, resetSeq, uid } from "./fixtures.js";

beforeEach(resetSeq);

const row = (scores: Score[], subject: string, entity: string | null): Score => {
  const r = scores.find((s) => s.subject === subject && s.entity === entity);
  if (!r) throw new Error(`no row ${subject}/${entity}`);
  return r;
};

describe("building blocks", () => {
  it("stake = 1 + ln(1 + usd/25)", () => {
    expect(stakeWeight(0)).toBe(1);
    expect(stakeWeight(40)).toBeCloseTo(1 + Math.log(2.6), 12);
  });
  it("decay = 0.5^(age/365), clamped at age 0", () => {
    expect(decay(0)).toBe(1);
    expect(decay(365)).toBeCloseTo(0.5, 12);
    expect(decay(730)).toBeCloseTo(0.25, 12);
    expect(decay(-10)).toBe(1);
  });
  it("Wilson lower bound matches the closed form and clamps", () => {
    const z = 1.96, p = 0.8, n = 10;
    const expected =
      (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
    expect(wilsonLowerBound(p, n)).toBeCloseTo(expected, 12);
    expect(wilsonLowerBound(0, 5)).toBe(0);
    expect(wilsonLowerBound(1, 1e9)).toBeCloseTo(1, 6);
    expect(wilsonLowerBound(0.5, 0)).toBe(0);
    // A perfect record with more evidence scores higher.
    expect(wilsonLowerBound(1, 10)).toBeGreaterThan(wilsonLowerBound(1, 2));
  });
  it("round is 6-decimal and normalizes -0", () => {
    expect(round(1 / 3)).toBe(0.333333);
    expect(Object.is(round(-0.0000001), 0)).toBe(true);
  });
});

describe("golden: one succeeded tier-2 $40 claim, age 0", () => {
  it("n = 1 + ln(2.6) ≈ 1.9555, p = 1, score = Wilson LB × 100", () => {
    const { scores } = computeReputation([att()], { now: NOW });
    const r = row(scores, "alice", "entity/boulder-creek");
    // §8.3: w = decay(0) × tier(2) × stake(40) = 1 × 1.0 × (1 + ln(1 + 40/25)).
    const n = 1 + Math.log(1 + 40 / 25);
    expect(n).toBeCloseTo(1.9555, 4);
    expect(r.n).toBe(round(n));
    expect(r.p).toBe(1);
    expect(r.score).toBe(round(wilsonLowerBound(1, n) * 100));
    expect(r.score).toBeCloseTo(33.7325, 3);
    expect(r.label).toBeNull();
    // The cross-entity row for a single entity equals the entity row.
    const x = row(scores, "alice", null);
    expect(x).toEqual({ ...r, entity: null });
  });
});

describe("golden: mix of succeeded / partial / failed", () => {
  it("p is the weight-weighted success mean", () => {
    const a = [att({ outcome: 0, usd_at_stake: 0 }), att({ outcome: 1, usd_at_stake: 0 }), att({ outcome: 2, usd_at_stake: 0 })];
    const r = row(computeReputation(a, { now: NOW }).scores, "alice", "entity/boulder-creek");
    // Each weight is 1 (stake(0) = 1, tier 2, age 0): n = 3, p = (1 + 0.5 + 0) / 3.
    expect(r.n).toBe(3);
    expect(r.p).toBe(0.5);
    expect(r.score).toBe(round(wilsonLowerBound(0.5, 3) * 100));
  });
  it("stake weights the mix: a big failure drags p below a small success", () => {
    const a = [att({ outcome: 0, usd_at_stake: 0 }), att({ outcome: 2, usd_at_stake: 500 })];
    const r = row(computeReputation(a, { now: NOW }).scores, "alice", "entity/boulder-creek");
    const wFail = stakeWeight(500);
    expect(r.n).toBe(round(1 + wFail));
    expect(r.p).toBe(round(1 / (1 + wFail)));
  });
});

describe("tier weights", () => {
  it("tier 3 is down-weighted to 0.4", () => {
    const r3 = row(computeReputation([att({ verification_tier: 3, usd_at_stake: 0 })], { now: NOW }).scores, "alice", "entity/boulder-creek");
    const r1 = row(computeReputation([att({ verification_tier: 1, usd_at_stake: 0 })], { now: NOW }).scores, "alice", "entity/boulder-creek");
    expect(r3.n).toBe(0.4);
    expect(r1.n).toBe(1);
    expect(TIER_WEIGHT).toEqual({ 1: 1.0, 2: 1.0, 3: 0.4, 4: 0.6 });
  });
  it("tier 4 weighs 0.6 until a follow-up outcome exists, then 1.0", () => {
    const deposit = att({ verification_tier: 4, usd_at_stake: 0 });
    const before = row(computeReputation([deposit], { now: NOW }).scores, "alice", "entity/boulder-creek");
    expect(before.n).toBe(0.6);

    const balance = att({ verification_tier: 4, usd_at_stake: 0, follow_up_of: deposit.uid });
    const after = row(computeReputation([deposit, balance], { now: NOW }).scores, "alice", "entity/boulder-creek");
    // Both the deposit outcome and the balance outcome now weigh 1.0.
    expect(after.n).toBe(2);
  });
  it("a revoked follow-up does not lift the deposit outcome", () => {
    const deposit = att({ verification_tier: 4, usd_at_stake: 0 });
    const balance = att({ verification_tier: 4, usd_at_stake: 0, follow_up_of: deposit.uid, revoked: true });
    const r = row(computeReputation([deposit, balance], { now: NOW }).scores, "alice", "entity/boulder-creek");
    expect(r.n).toBe(0.6);
  });
});

describe("exclusions", () => {
  it("revoked attestations are excluded from scores but listed in inputs", () => {
    const good = att({ usd_at_stake: 0 });
    const bad = att({ usd_at_stake: 0, outcome: 2, revoked: true });
    const file = computeReputation([good, bad], { now: NOW });
    const r = row(file.scores, "alice", "entity/boulder-creek");
    expect(r.n).toBe(1);
    expect(r.p).toBe(1);
    expect(file.inputs).toEqual([good.uid, bad.uid].sort());
  });
  it("unverifiable outcomes are excluded", () => {
    const file = computeReputation([att({ usd_at_stake: 0 }), att({ usd_at_stake: 0, outcome: 3 })], { now: NOW });
    expect(row(file.scores, "alice", "entity/boulder-creek").n).toBe(1);
  });
  it("a subject with only excluded attestations has no rows at all", () => {
    const file = computeReputation([att({ outcome: 3 }), att({ revoked: true })], { now: NOW });
    expect(file.scores).toEqual([]);
    expect(file.inputs).toHaveLength(2);
  });
});

describe("decay", () => {
  it("halves the weight at 365 days and quarters it at 730", () => {
    const fresh = row(computeReputation([att({ usd_at_stake: 0 })], { now: NOW }).scores, "alice", "entity/boulder-creek");
    const year = row(computeReputation([att({ usd_at_stake: 0, attested_at: agedIso(365) })], { now: NOW }).scores, "alice", "entity/boulder-creek");
    const two = row(computeReputation([att({ usd_at_stake: 0, attested_at: agedIso(730) })], { now: NOW }).scores, "alice", "entity/boulder-creek");
    expect(fresh.n).toBe(1);
    expect(year.n).toBe(0.5);
    expect(two.n).toBe(0.25);
    expect(year.label).toBe("new");
  });
  it("the same attestations viewed from a later `now` decay further", () => {
    const a = [att()];
    const n0 = row(computeReputation(a, { now: NOW }).scores, "alice", "entity/boulder-creek").n;
    const n1 = row(computeReputation(a, { now: agedIso(-365) }).scores, "alice", "entity/boulder-creek").n;
    expect(n1).toBe(round(n0 / 2));
  });
});

describe('"new" under n < 1', () => {
  it("score is null and label is new when n < 1; p is still reported", () => {
    const r = row(computeReputation([att({ verification_tier: 3, usd_at_stake: 0 })], { now: NOW }).scores, "alice", "entity/boulder-creek");
    expect(r.n).toBe(0.4);
    expect(r.p).toBe(1);
    expect(r.score).toBeNull();
    expect(r.label).toBe("new");
  });
  it("n = 1 exactly is not new", () => {
    const r = row(computeReputation([att({ usd_at_stake: 0 })], { now: NOW }).scores, "alice", "entity/boulder-creek");
    expect(r.n).toBe(1);
    expect(r.label).toBeNull();
    expect(r.score).not.toBeNull();
  });
});

describe("cross-entity row", () => {
  it("is the n-weighted mean of the subject's entity scores", () => {
    const a = [
      att({ entity_id: "entity/boulder-creek", outcome: 0, usd_at_stake: 0 }),
      att({ entity_id: "entity/boulder-creek", outcome: 0, usd_at_stake: 0 }),
      att({ entity_id: "entity/boulder-creek", outcome: 0, usd_at_stake: 0 }), // n=3, p=1
      att({ entity_id: "entity/coal-creek", outcome: 2, usd_at_stake: 0 }), // n=1, p=0
    ];
    const { scores } = computeReputation(a, { now: NOW });
    const bc = row(scores, "alice", "entity/boulder-creek");
    const cc = row(scores, "alice", "entity/coal-creek");
    const x = row(scores, "alice", null);
    expect(bc.n).toBe(3);
    expect(cc.n).toBe(1);
    expect(x.n).toBe(4);
    expect(x.p).toBe(0.75);
    // Weighted mean of the *scores* (Wilson bounds), not a pooled Wilson.
    const expected = (3 * wilsonLowerBound(1, 3) * 100 + 1 * wilsonLowerBound(0, 1) * 100) / 4;
    expect(x.score).toBe(round(expected));
    expect(x.score).not.toBe(round(wilsonLowerBound(0.75, 4) * 100));
  });
  it("entities that are 'new' do not enter the mean; all-new ⇒ cross-entity new", () => {
    const a = [
      att({ entity_id: "entity/boulder-creek", usd_at_stake: 0 }), // n=1
      att({ entity_id: "entity/coal-creek", verification_tier: 3, usd_at_stake: 0 }), // n=0.4 → new
    ];
    const { scores } = computeReputation(a, { now: NOW });
    const x = row(scores, "alice", null);
    expect(x.n).toBe(1.4);
    expect(x.score).toBe(row(scores, "alice", "entity/boulder-creek").score);
    expect(x.label).toBeNull();

    const allNew = computeReputation(
      [att({ entity_id: "entity/a", verification_tier: 3, usd_at_stake: 0 }), att({ entity_id: "entity/b", verification_tier: 3, usd_at_stake: 0 })],
      { now: NOW },
    );
    expect(row(allNew.scores, "alice", null)).toMatchObject({ n: 0.8, score: null, label: "new" });
  });
  it("nothing pools across subjects", () => {
    const a = [att({ subject: "alice", usd_at_stake: 0 }), att({ subject: "bob", outcome: 2, usd_at_stake: 0 })];
    const { scores } = computeReputation(a, { now: NOW });
    expect(row(scores, "alice", null).p).toBe(1);
    expect(row(scores, "bob", null).p).toBe(0);
  });
});

describe("passport gate", () => {
  it("passport_ok reflects passport ≥ passport_min; the score is computed either way", () => {
    const a = [att({ subject: "alice" }), att({ subject: "bob" }), att({ subject: "carol" })];
    const passport = new Map([["alice", 20], ["bob", 19.9]]); // carol unknown
    const { scores } = computeReputation(a, { now: NOW, passport });
    expect(row(scores, "alice", null).passport_ok).toBe(true);
    expect(row(scores, "alice", "entity/boulder-creek").passport_ok).toBe(true);
    expect(row(scores, "bob", null).passport_ok).toBe(false);
    expect(row(scores, "bob", null).score).not.toBeNull();
    expect(row(scores, "carol", null).passport_ok).toBe(false);
  });
  it("passport_min is configurable (default 20)", () => {
    const a = [att({ subject: "bob" })];
    const passport = new Map([["bob", 15]]);
    expect(row(computeReputation(a, { now: NOW, passport }).scores, "bob", null).passport_ok).toBe(false);
    expect(row(computeReputation(a, { now: NOW, passport, passport_min: 15 }).scores, "bob", null).passport_ok).toBe(true);
  });
});

describe("entity's own score (tier-1 predictions)", () => {
  it("is the fraction of resolved predictions whose observed direction matched", () => {
    const preds = [
      prediction({ observed_direction: "down" }),
      prediction({ observed_direction: "up" }),
      prediction({ observed_direction: "down" }),
      prediction({ observed_direction: null }), // unresolved: excluded
      prediction({ window_end: agedIso(-5), observed_direction: "down" }), // window still open: excluded
      prediction({ entity: "entity/coal-creek", observed_direction: null }),
    ];
    const { entity_scores } = computeReputation([], { now: NOW, predictions: preds });
    expect(entity_scores).toEqual([
      { entity: "entity/boulder-creek", predictions_n: 3, correct_n: 2, accuracy: round(2 / 3) },
      { entity: "entity/coal-creek", predictions_n: 0, correct_n: 0, accuracy: null },
    ]);
    expect(computeEntityScores([], Date.parse(NOW))).toEqual([]);
  });
});

describe("file shape and determinism", () => {
  it("has the reputation/v1 shape, sorted inputs, and root over inputs", () => {
    const a = [att({ uid: uid(9) }), att({ uid: uid(3) }), att({ uid: uid(5), subject: "bob", entity_id: "entity/z" })];
    const file = computeReputation(a, { now: NOW });
    expect(file.function).toBe("reputation/v1");
    expect(file.computed_at).toBe(NOW);
    expect(file.inputs).toEqual([uid(3), uid(5), uid(9)]);
    expect(file.root_of_uids).toBe(merkleRootOfUids([uid(9), uid(3), uid(5)]));
    expect(Object.keys(file).sort()).toEqual(["computed_at", "entity_scores", "function", "inputs", "root_of_uids", "scores"]);
    expect(Object.keys(file.scores[0]!).sort()).toEqual(["entity", "label", "n", "p", "passport_ok", "score", "subject"]);
  });
  it("orders scores by subject, cross-entity row first, then entity", () => {
    const a = [
      att({ subject: "bob", entity_id: "entity/b" }),
      att({ subject: "alice", entity_id: "entity/z" }),
      att({ subject: "alice", entity_id: "entity/a" }),
    ];
    const keys = computeReputation(a, { now: NOW }).scores.map((s) => `${s.subject}:${s.entity}`);
    expect(keys).toEqual(["alice:null", "alice:entity/a", "alice:entity/z", "bob:null", "bob:entity/b"]);
  });
  it("is independent of attestation input order", () => {
    const a = [att(), att({ subject: "bob" }), att({ entity_id: "entity/coal-creek", outcome: 1 }), att({ verification_tier: 4 })];
    const f1 = computeReputation(a, { now: NOW });
    const f2 = computeReputation([...a].reverse(), { now: NOW });
    expect(f2).toEqual(f1);
  });
  it("accepts `now` as Date, string or epoch ms and normalizes computed_at", () => {
    const t = Date.parse(NOW);
    expect(computeReputation([], { now: new Date(t) }).computed_at).toBe(NOW);
    expect(computeReputation([], { now: t }).computed_at).toBe(NOW);
    expect(computeReputation([], { now: "2026-09-06T02:00:00+02:00" }).computed_at).toBe(NOW);
  });
});
