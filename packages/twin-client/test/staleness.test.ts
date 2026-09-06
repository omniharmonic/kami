import { describe, expect, it } from "vitest";

import {
  SOURCE_THRESHOLDS,
  readingStaleness,
  sourceStatusFromThresholds,
  withStaleness,
  type HealthBoard,
  type Reading,
} from "../src/index.js";

const NOW = Date.parse("2026-09-06T06:00:00Z");

describe("readingStaleness — the twin's resolver, ported exactly", () => {
  it("threshold dialect (place page): computes against now", () => {
    const r: Reading = { property: "discharge", source_id: "cdss.telemetry", time: "2026-09-06T05:30:00Z", staleness_crit_s: 10800 };
    expect(readingStaleness(r, NOW)).toEqual({ seconds: 1800, stale: false, unknown: false });
    const old: Reading = { ...r, time: "2026-09-04T20:15:00Z" };
    expect(readingStaleness(old, NOW)).toEqual({ seconds: 121500, stale: true, unknown: false });
  });

  it("verdict dialect (conditions.json): uses the published flag; age from time when present", () => {
    const r: Reading = { property: "discharge", source_id: "cdss.telemetry", time: "2026-09-04T20:15:00Z", staleness_s: 118000, stale: true };
    expect(readingStaleness(r, NOW)).toEqual({ seconds: 121500, stale: true, unknown: false });
    const noTime: Reading = { property: "discharge", source_id: "cdss.telemetry", staleness_s: 42, stale: false };
    expect(readingStaleness(noTime, NOW)).toEqual({ seconds: 42, stale: false, unknown: false });
  });

  it("threshold wins over flag when both are present", () => {
    const r: Reading = { property: "swe", source_id: "nrcs.awdb", time: "2026-09-04T06:00:00Z", staleness_crit_s: 86400, stale: false, staleness_s: 10 };
    expect(readingStaleness(r, NOW).stale).toBe(true);
  });

  it("neither dialect → unknown, which is not fresh", () => {
    const r: Reading = { property: "discharge", source_id: "cdss.telemetry", time: "2026-09-06T05:59:00Z" };
    const s = readingStaleness(r, NOW);
    expect(s).toEqual({ seconds: 60, stale: false, unknown: true });
    const h = withStaleness(r, NOW);
    expect(h.fresh).toBe(false);
    expect(h.staleness_unknown).toBe(true);
    const bare: Reading = { property: "discharge", source_id: "cdss.telemetry" };
    expect(readingStaleness(bare, NOW)).toEqual({ seconds: null, stale: false, unknown: true });
    expect(withStaleness(bare, NOW).staleness_s).toBeNull();
  });
});

describe("withStaleness — the honesty fields", () => {
  it("place-page dialect: five fields + source_status from the thresholds table", () => {
    const r: Reading = { property: "discharge", value: 15.4, unit: "[ft_i]3/s", source_id: "cdss.telemetry", time: "2026-09-04T20:15:00Z", staleness_crit_s: 10800 };
    const h = withStaleness(r, NOW);
    expect(h).toMatchObject({ time: "2026-09-04T20:15:00Z", unit: "[ft_i]3/s", source_id: "cdss.telemetry", stale: true, staleness_s: 121500, source_status: "critical", fresh: false });
  });

  it("conditions dialect: keeps the published verdict; warning band from the table", () => {
    const r: Reading = { property: "pm25", value: 6.2, unit: "ug/m3", source_id: "epa.airnow", time: "2026-09-06T01:00:00Z", staleness_s: 18000, stale: false };
    const h = withStaleness(r, NOW);
    expect(h.stale).toBe(false);
    expect(h.staleness_s).toBe(18000);
    expect(h.source_status).toBe("warning"); // 18000 > 10800 warn, < 43200 crit
    expect(h.fresh).toBe(true);
  });

  it("absent unit/time become explicit null, never zero", () => {
    const h = withStaleness({ property: "x", source_id: "nobody.knows", stale: false, staleness_s: 5 }, NOW);
    expect(h.time).toBeNull();
    expect(h.unit).toBeNull();
    expect(h.source_status).toBe("unknown");
  });

  it("prefers the health board's verdict when one is supplied", () => {
    const board: HealthBoard = {
      schema_version: "1.0",
      generated_at: "2026-09-06T06:00:00Z",
      sources: [{ source_id: "cdss.telemetry", attribution: "DWR", health: "ok" }],
    };
    const r: Reading = { property: "discharge", source_id: "cdss.telemetry", time: "2026-09-04T20:15:00Z", staleness_crit_s: 10800 };
    const h = withStaleness(r, NOW, SOURCE_THRESHOLDS, board);
    expect(h.stale).toBe(true); // the reading is stale …
    expect(h.source_status).toBe("ok"); // … while the feed is up: two different questions (survey §4.1)
  });
});

describe("SOURCE_THRESHOLDS", () => {
  it("matches sources.seed.yaml for the sources Boulder Creek senses through", () => {
    expect(SOURCE_THRESHOLDS["cdss.telemetry"]?.staleness_crit_s).toBe(10800);
    expect(SOURCE_THRESHOLDS["nrcs.awdb"]?.staleness_crit_s).toBe(86400);
    expect(SOURCE_THRESHOLDS["epa.airnow"]?.staleness_crit_s).toBe(43200);
    expect(SOURCE_THRESHOLDS["usdm.current"]?.staleness_crit_s).toBe(1382400);
    expect(SOURCE_THRESHOLDS["derived.fill"]?.staleness_crit_s).toBe(86400);
    expect(Object.keys(SOURCE_THRESHOLDS)).toHaveLength(22);
  });

  it("verdict ladder: unknown / critical / warning / ok", () => {
    expect(sourceStatusFromThresholds("cdss.telemetry", null)).toBe("unknown");
    expect(sourceStatusFromThresholds("cdss.telemetry", 10801)).toBe("critical");
    expect(sourceStatusFromThresholds("cdss.telemetry", 2701)).toBe("warning");
    expect(sourceStatusFromThresholds("cdss.telemetry", 2700)).toBe("ok");
    expect(sourceStatusFromThresholds("not.a.source", 1)).toBe("unknown");
  });
});
