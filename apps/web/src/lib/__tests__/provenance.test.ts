/**
 * Provenance: what is serving a kami, and how we know.
 *
 * The gate's live report beats anything on disk; the Hermes profile is a
 * fallback that can name a model but never a placement; nothing at all is a
 * real answer ("unknown") rather than a flattering default. A report older than
 * 24 h is last-known, not current fact — the twin's staleness rule applied to
 * the platform's own machinery.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDbForTests } from "@/db/client";
import * as schema from "@/db/schema";
import { closeTestDb, createTestDb, type TestDb } from "@/db/test-utils";
import {
  isStale,
  mayClaimNoFrontierModel,
  MAX_AGE_MS,
  parseGateReport,
  servingProvenance,
  stalenessSeconds,
  UNKNOWN_PROVENANCE,
} from "@/lib/provenance";

let db: TestDb;

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const HOUR = 3_600_000;

async function report(key: string, value: unknown) {
  await db.insert(schema.config).values({ key, value: value as object }).onConflictDoUpdate({ target: schema.config.key, set: { value: value as object } });
}

beforeEach(async () => {
  db = await createTestDb();
  setDbForTests(db);
});

afterEach(async () => {
  setDbForTests(null);
  await closeTestDb(db);
});

describe("servingProvenance", () => {
  it("prefers the gate's live report over the profile file on disk", async () => {
    // boulder-creek has a real profile in profiles/ asking for qwen3.5-9b; the
    // gate says something else is actually answering, and the gate wins.
    await report("gate_provenance.boulder-creek", {
      placement: "hosted",
      provider: "together.ai",
      model: "Qwen3.5-9B-Instruct",
      at: iso(5 * 60_000),
    });
    const p = await servingProvenance("boulder-creek", NOW);
    expect(p.source).toBe("gate");
    expect(p.placement).toBe("hosted");
    expect(p.provider).toBe("together.ai");
    expect(p.model).toBe("Qwen3.5-9B-Instruct");
    expect(p.stale).toBe(false);
    expect(p.staleness_s).toBe(300);
  });

  it("falls back to the Hermes profile when the gate has not reported", async () => {
    const p = await servingProvenance("boulder-creek", NOW);
    expect(p.source).toBe("profile");
    expect(p.model).toBe("qwen3.5-9b");
    expect(p.reasoning_effort).toBe("low");
    // A file on disk asks for a model. It cannot know whose machine runs it.
    expect(p.placement).toBeNull();
    expect(p.provider).toBeNull();
    expect(p.at).toBeNull();
    expect(p.staleness_s).toBeNull();
  });

  it("says unknown when neither the gate nor a profile has anything", async () => {
    expect(await servingProvenance("ghost-creek", NOW)).toEqual(UNKNOWN_PROVENANCE);
  });

  it("uses the box-wide default key when the kami has no key of its own", async () => {
    await report("gate_provenance.default", { placement: "rented", provider: "RunPod", model: "qwen3.5-9b", at: iso(HOUR) });
    const p = await servingProvenance("ghost-creek", NOW);
    expect(p.source).toBe("gate");
    expect(p.placement).toBe("rented");
    expect(p.provider).toBe("RunPod");
  });

  it("prefers the kami's own key over the box-wide default", async () => {
    await report("gate_provenance.default", { placement: "rented", provider: "RunPod", model: "qwen3.5-9b", at: iso(HOUR) });
    await report("gate_provenance.ghost-creek", { placement: "hosted", provider: "together.ai", model: "gpt-oss-120b", at: iso(HOUR) });
    const p = await servingProvenance("ghost-creek", NOW);
    expect(p.placement).toBe("hosted");
    expect(p.provider).toBe("together.ai");
  });

  it("marks a 30-hour-old report stale but still reports it, with its age", async () => {
    await report("gate_provenance.ghost-creek", { placement: "owned", provider: "the box", model: "qwen3.5-9b", at: iso(30 * HOUR) });
    const p = await servingProvenance("ghost-creek", NOW);
    expect(p.stale).toBe(true);
    expect(p.at).toBe(iso(30 * HOUR));
    expect(p.staleness_s).toBe(30 * 3600);
    // Stale means the strongest claim on the page is withheld.
    expect(mayClaimNoFrontierModel(p)).toBe(false);
  });

  it("ignores a malformed report rather than turning it into a claim", async () => {
    await report("gate_provenance.boulder-creek", { placement: "somewhere-nice", provider: 7 });
    const p = await servingProvenance("boulder-creek", NOW);
    expect(p.source).toBe("profile");
  });

  it("keeps a report that names a placement but no model, and vice versa", async () => {
    await report("gate_provenance.ghost-creek", { placement: "hosted", at: iso(60_000) });
    expect((await servingProvenance("ghost-creek", NOW)).model).toBeNull();
    await report("gate_provenance.ghost-creek", { model: "qwen3.5-9b", at: iso(60_000) });
    const p = await servingProvenance("ghost-creek", NOW);
    expect(p.model).toBe("qwen3.5-9b");
    expect(p.placement).toBeNull();
  });

  it("carries the gate's guard mode through, so the page can say when the guard is off", async () => {
    await report("gate_provenance.ghost-creek", { placement: "hosted", provider: "together.ai", model: "m", guard: "passthrough", at: iso(60_000) });
    expect((await servingProvenance("ghost-creek", NOW)).guard).toBe("passthrough");
    await report("gate_provenance.ghost-creek", { placement: "hosted", provider: "together.ai", model: "m", guard: "nonsense", at: iso(60_000) });
    expect((await servingProvenance("ghost-creek", NOW)).guard).toBeNull();
  });

  it("survives having no database at all — unknown, not a guess", async () => {
    setDbForTests(null);
    expect((await servingProvenance("ghost-creek", NOW)).source).toBe("unknown");
  });
});

describe("parseGateReport", () => {
  it("rejects non-objects, empty reports, and unknown placements", () => {
    for (const bad of [null, undefined, 7, "hosted", [], {}, { placement: "borrowed" }, { provider: "together.ai" }]) {
      expect(parseGateReport(bad)).toBeNull();
    }
  });

  it("drops an unparseable timestamp instead of pretending it is a time", () => {
    expect(parseGateReport({ placement: "owned", model: "m", at: "soon" })?.at).toBeNull();
  });
});

describe("isStale / stalenessSeconds", () => {
  it("treats a missing or unparseable time as stale — absent is unknown, never fresh", () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale(undefined, NOW)).toBe(true);
    expect(isStale("not a time", NOW)).toBe(true);
    expect(stalenessSeconds(null, NOW)).toBeNull();
  });

  it("holds the line exactly at the 24-hour window", () => {
    expect(isStale(iso(MAX_AGE_MS), NOW)).toBe(false);
    expect(isStale(iso(MAX_AGE_MS + 1000), NOW)).toBe(true);
    expect(isStale(iso(HOUR), NOW)).toBe(false);
  });
});

describe("mayClaimNoFrontierModel", () => {
  const base = { provider: "x", model: "m", at: iso(HOUR), staleness_s: 3600, guard: "factguard", reasoning_effort: null, stale: false } as const;

  it("is true only for a fresh gate report on an owned or rented GPU", () => {
    expect(mayClaimNoFrontierModel({ ...base, placement: "owned", source: "gate" })).toBe(true);
    expect(mayClaimNoFrontierModel({ ...base, placement: "rented", source: "gate" })).toBe(true);
    expect(mayClaimNoFrontierModel({ ...base, placement: "hosted", source: "gate" })).toBe(false);
    expect(mayClaimNoFrontierModel({ ...base, placement: null, source: "gate" })).toBe(false);
    expect(mayClaimNoFrontierModel({ ...base, placement: "owned", source: "gate", stale: true })).toBe(false);
    expect(mayClaimNoFrontierModel({ ...base, placement: "owned", source: "profile" })).toBe(false);
    expect(mayClaimNoFrontierModel(UNKNOWN_PROVENANCE)).toBe(false);
  });
});
