import { describe, expect, it } from "vitest";
import { readingStaleness, readingStalenessWithFallback, sourceStatus, SOURCE_THRESHOLDS } from "../src/staleness.js";

const now = Date.parse("2026-09-06T05:00:00Z");

describe("readingStaleness — the two dialects (port of web/src/data/reading.ts)", () => {
  it("threshold dialect: computes against the clock, so a cached page cannot rot", () => {
    const fresh = readingStaleness({ time: "2026-09-06T04:45:00Z", staleness_crit_s: 10800 }, now);
    expect(fresh).toEqual({ seconds: 900, stale: false, unknown: false });
    const old = readingStaleness({ time: "2026-09-04T20:15:00Z", staleness_crit_s: 10800 }, now);
    expect(old.stale).toBe(true);
    expect(old.seconds).toBe(117900);
    expect(old.unknown).toBe(false);
  });

  it("flag dialect: trusts the publisher's verdict, age from time when present", () => {
    const r = readingStaleness({ time: "2026-09-04T20:15:00Z", stale: true, staleness_s: 117900 }, now);
    expect(r).toEqual({ seconds: 117900, stale: true, unknown: false });
    const noTime = readingStaleness({ stale: false, staleness_s: 42 }, now);
    expect(noTime).toEqual({ seconds: 42, stale: false, unknown: false });
  });

  it("threshold wins over flag when both are present", () => {
    const r = readingStaleness({ time: "2026-09-04T20:15:00Z", staleness_crit_s: 10800, stale: false, staleness_s: 10 }, now);
    expect(r.stale).toBe(true);
  });

  it("unknown ≠ fresh: neither dialect gives unknown: true, never stale: true", () => {
    const r = readingStaleness({ time: "2026-09-06T04:00:00Z" }, now);
    expect(r).toEqual({ seconds: 3600, stale: false, unknown: true });
    expect(readingStaleness({}, now)).toEqual({ seconds: null, stale: false, unknown: true });
    expect(readingStaleness({ time: "not a date", staleness_crit_s: 10 }, now).unknown).toBe(true);
  });

  it("a future time clamps to age 0 (a forecast is never stale by age)", () => {
    expect(readingStaleness({ time: "2026-09-06T12:00:00Z", staleness_crit_s: 43200 }, now).seconds).toBe(0);
  });

  it("the seed table only fills in when both dialects are absent", () => {
    const r = readingStalenessWithFallback({ property: "discharge", source_id: "cdss.telemetry", time: "2026-09-04T20:15:00Z" }, now);
    expect(r).toEqual({ seconds: 117900, stale: true, unknown: false });
    const unknownSource = readingStalenessWithFallback({ property: "x", source_id: "nobody.knows", time: "2026-09-04T20:15:00Z" }, now);
    expect(unknownSource.unknown).toBe(true);
    expect(SOURCE_THRESHOLDS["cdss.telemetry"]).toEqual({ warn_s: 2700, crit_s: 10800, tier: "A" });
    expect(SOURCE_THRESHOLDS["usdm.current"]!.crit_s).toBe(1382400);
  });
});

describe("sourceStatus — meta.v_source_health's CASE", () => {
  it("unknown | critical | warning | failing→warning | ok, in that order", () => {
    expect(sourceStatus(null, 2700, 10800)).toBe("unknown");
    expect(sourceStatus(undefined, 2700, 10800)).toBe("unknown");
    expect(sourceStatus(10801, 2700, 10800)).toBe("critical");
    expect(sourceStatus(2701, 2700, 10800)).toBe("warning");
    expect(sourceStatus(100, 2700, 10800, true)).toBe("warning");
    expect(sourceStatus(100, 2700, 10800)).toBe("ok");
    expect(sourceStatus(10800, 2700, 10800)).toBe("warning"); // boundary is not past crit
  });
});
