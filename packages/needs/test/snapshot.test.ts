import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyDeltas,
  computeSnapshot,
  hasNotableDelta,
  needLabel,
  snapshotHash,
  snapshotToRiveInputs,
  type HealthSnapshot,
  type LiveInputs,
  type NeedInput,
  type NeedName,
  type NeedSpec,
} from "../src/index.js";
import { NOW, SPECS, healthyReadings, hourLater, live, opts, reading } from "./helpers.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("computeSnapshot — shape and labels", () => {
  const s = computeSnapshot("entity/test", SPECS, healthyReadings(), live(), opts());

  it("carries the schema fields and one need per spec, in spec order", () => {
    expect(s.schema_version).toBe("1.0");
    expect(s.entity_id).toBe("entity/test");
    expect(s.as_of).toBe(NOW.toISOString());
    expect(s.needs.map((n) => n.need)).toEqual(SPECS.map((sp) => sp.need));
    expect(s.season).toBe(2); // September = monsoon
    expect(s.cosmetics).toEqual({});
  });

  it("every need carries the invariant fields", () => {
    for (const n of s.needs) {
      for (const k of ["time", "unit", "source_id", "stale", "staleness_s", "source_status"]) expect(n).toHaveProperty(k);
    }
  });

  it("templated labels use display units and short place names", () => {
    const byNeed = Object.fromEntries(s.needs.map((n) => [n.need, n]));
    expect(byNeed.flow!.label).toBe("15.4 cfs at Orodell, 2026-09-06 04:00Z");
    expect(byNeed.storage!.label).toBe("85 % at Gross Reservoir, 2026-09-06 04:00Z");
    expect(byNeed.snow!.label).toBe("0 in at Niwot, 2026-09-06 04:00Z");
    expect(byNeed.air!.label).toBe("5.5 µg/m³ at Athens St, 2026-09-06 04:00Z");
    expect(byNeed.drought!.label).toBe("no dm reading");
  });

  it("a stale label ends in ', stale' and a missing reading says so", () => {
    const spec: NeedSpec = SPECS[0]!;
    expect(needLabel(spec, reading({ value: 15.4, unit: "[ft_i]3/s", time: "2026-09-04T20:15:00Z", stale: true }))).toBe(
      "15.4 cfs at Orodell, 2026-09-04 20:15Z, stale",
    );
    expect(needLabel(spec, null)).toBe("no discharge reading at Orodell");
    expect(needLabel({ ...spec, place_label: undefined }, null)).toBe("no discharge reading at boulder creek near orodell co");
    expect(needLabel({ need: "drought", property: "dm", places: [], agg: "max_intersecting" }, reading({ value: 1, unit: "{dm}", time: "2026-09-02T12:00:00Z" }))).toBe(
      "D1, 2026-09-02 12:00Z",
    );
  });

  it("unknown units pass through; °C and acre-feet map", () => {
    const spec: NeedSpec = { need: "water", property: "water_temperature", places: ["place/x"], agg: "single", place_label: "X" };
    expect(needLabel(spec, reading({ value: 12.34, unit: "Cel", time: null }))).toBe("12.34 °C at X");
    expect(needLabel(spec, reading({ value: 1000, unit: "[acr_us].[ft_i]", time: null }))).toBe("1000 acre-feet at X");
    expect(needLabel(spec, reading({ value: 3, unit: "umho/cm", time: null }))).toBe("3 umho/cm at X");
  });

  it("trend_7d comes from series_summary.trend, else null", () => {
    const r = healthyReadings();
    r.flow = reading({ ...r.flow!, series_summary: { min: 10, max: 20, last: 15.4, trend: "falling", n: 7 } });
    const s2 = computeSnapshot("entity/test", SPECS, r, live(), opts());
    expect(s2.needs[0]!.trend_7d).toBe("falling");
    expect(s2.needs[1]!.trend_7d).toBeNull();
  });

  it("a missing reading is health null, not stale, source_status unknown, and excluded from aggregates", () => {
    const r = healthyReadings();
    r.storage = null;
    const s2 = computeSnapshot("entity/test", SPECS, r, live(), opts());
    const st = s2.needs.find((n) => n.need === "storage")!;
    expect(st.stale).toBe(false);
    expect(st.health).toBeNull();
    expect(st.source_status).toBe("unknown");
    expect(s2.stale_driving).toBe(false);
    expect(s2.mood).toBe("content");
  });

  it("a stale reading keeps its last value and band but has health null", () => {
    const r = healthyReadings();
    r.storage = reading({ value: 30, unit: "%", stale: true });
    const s2 = computeSnapshot("entity/test", SPECS, r, live(), opts());
    const st = s2.needs.find((n) => n.need === "storage")!;
    expect(st.value).toBe(30);
    expect(st.band).toBe("low");
    expect(st.health).toBeNull();
  });

  it("drought_class falls back to a fresh dm reading when live has none", () => {
    const r = healthyReadings();
    r.drought = reading({ value: 2, unit: "{dm}", source_id: "usdm.current" });
    const s2 = computeSnapshot("entity/test", SPECS, r, live({ drought_class: null }), opts());
    expect(s2.drought_class).toBe(2);
    expect(s2.mood).toBe("distressed");
  });

  it("cosmetics are copied, not shared", () => {
    const cosmetics = { hat: 1 };
    const s2 = computeSnapshot("entity/test", SPECS, healthyReadings(), live(), opts({ cosmetics }));
    cosmetics.hat = 5;
    expect(s2.cosmetics.hat).toBe(1);
  });
});

describe("snapshotHash", () => {
  const base = computeSnapshot("entity/test", SPECS, healthyReadings(), live(), opts());

  it("is a 64-hex sha256", () => {
    expect(snapshotHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is unchanged when only as_of and staleness_s change", () => {
    const r = healthyReadings();
    for (const k of Object.keys(r) as NeedName[]) if (r[k]) r[k] = { ...r[k]!, staleness_s: (r[k]!.staleness_s ?? 0) + 3600 };
    const later = computeSnapshot("entity/test", SPECS, r, live(), opts({ now: hourLater(opts(), 1) }));
    expect(later.as_of).not.toBe(base.as_of);
    expect(snapshotHash(later)).toBe(snapshotHash(base));
  });

  it("changes when a value changes", () => {
    const r = healthyReadings();
    r.flow = reading({ ...r.flow!, value: 15.5 });
    expect(snapshotHash(computeSnapshot("entity/test", SPECS, r, live(), opts()))).not.toBe(snapshotHash(base));
  });

  it("changes when stale flips, drought/alert/flood change", () => {
    const r = healthyReadings();
    r.flow = reading({ ...r.flow!, stale: true });
    expect(snapshotHash(computeSnapshot("entity/test", SPECS, r, live(), opts()))).not.toBe(snapshotHash(base));
    expect(snapshotHash(computeSnapshot("entity/test", SPECS, healthyReadings(), live({ drought_class: 1 }), opts()))).not.toBe(snapshotHash(base));
    expect(snapshotHash(computeSnapshot("entity/test", SPECS, healthyReadings(), live({ alerts: [{ severity: "Minor" }] }), opts()))).not.toBe(snapshotHash(base));
    expect(snapshotHash(computeSnapshot("entity/test", SPECS, healthyReadings(), live({ flood_category: "action" }), opts()))).not.toBe(snapshotHash(base));
  });

  it("ignores mood (which hysteresis can hold) and cosmetics", () => {
    expect(snapshotHash({ ...base, mood: "celebrating", mood_reason: "x", cosmetics: { hat: 1 } })).toBe(snapshotHash(base));
  });
});

describe("classifyDeltas", () => {
  const o = opts();
  const prev = computeSnapshot("entity/test", SPECS, healthyReadings(), live(), o);

  it("value jitter is a value_change and not notable", () => {
    const r = healthyReadings();
    r.flow = reading({ ...r.flow!, value: 15.6 });
    const next = computeSnapshot("entity/test", SPECS, r, live(), opts({ now: hourLater(o), previous_snapshots: [prev] }));
    const d = classifyDeltas(prev, next);
    expect(d).toEqual([{ kind: "value_change", need: "flow", field: "value", from: 15.4, to: 15.6, notable: false }]);
    expect(hasNotableDelta(d)).toBe(false);
  });

  it("a stale flip is notable (and the mood change with it)", () => {
    const r = healthyReadings();
    r.flow = reading({ ...r.flow!, stale: true });
    const next = computeSnapshot("entity/test", SPECS, r, live(), opts({ now: hourLater(o), previous_snapshots: [prev] }));
    const d = classifyDeltas(prev, next);
    expect(d.map((x) => x.kind).sort()).toEqual(["mood_change", "stale_flip"]);
    expect(d.every((x) => x.notable)).toBe(true);
  });

  it("a band change is notable; value_change rides along", () => {
    const r = healthyReadings();
    r.storage = reading({ ...r.storage!, value: 60 }); // near normal → below normal
    const next = computeSnapshot("entity/test", SPECS, r, live(), opts({ now: hourLater(o), previous_snapshots: [prev] }));
    const d = classifyDeltas(prev, next);
    expect(d).toContainEqual({ kind: "band_change", need: "storage", field: "band", from: "near normal", to: "below normal", notable: true });
    expect(d.find((x) => x.kind === "value_change")!.notable).toBe(false);
    expect(hasNotableDelta(d)).toBe(true);
  });

  it("alert_start / alert_end", () => {
    const withAlert = computeSnapshot("entity/test", SPECS, healthyReadings(), live({ alerts: [{ severity: "Minor" }] }), opts({ now: hourLater(o) }));
    expect(classifyDeltas(prev, withAlert)).toContainEqual({ kind: "alert_start", need: "alerts", field: "alert_level", from: 0, to: 1, notable: true });
    expect(classifyDeltas(withAlert, prev)).toContainEqual({ kind: "alert_end", need: "alerts", field: "alert_level", from: 1, to: 0, notable: true });
    // 1 → 3 is neither start nor end
    const severe = { ...withAlert, alert_level: 3 as const };
    expect(classifyDeltas(withAlert, severe).filter((d) => d.kind.startsWith("alert"))).toHaveLength(0);
  });

  it("drought and flood category changes are band changes", () => {
    const next = computeSnapshot("entity/test", SPECS, healthyReadings(), live({ drought_class: 1, flood_category: "action" }), opts({ now: hourLater(o) }));
    const d = classifyDeltas(prev, next);
    expect(d).toContainEqual({ kind: "band_change", need: "drought", field: "drought_class", from: null, to: 1, notable: true });
    expect(d).toContainEqual({ kind: "band_change", need: "stage", field: "flood_category", from: null, to: "action", notable: true });
  });

  it("identical snapshots produce no deltas", () => {
    expect(classifyDeltas(prev, { ...prev, as_of: "2030-01-01T00:00:00Z" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The all-stale 2026-09-06 Boulder Creek build
// ---------------------------------------------------------------------------

type Fixture = {
  entity_id: string;
  now: string;
  specs: NeedSpec[];
  readings: Record<NeedName, NeedInput>;
  live: LiveInputs;
  gpu_online: boolean;
  paused: boolean;
};

describe("fixture: Boulder Creek 2026-09-06 (all water stale)", () => {
  const fx = JSON.parse(readFileSync(join(here, "fixtures", "boulder-creek-2026-09-06.json"), "utf8")) as Fixture;
  const snap: HealthSnapshot = computeSnapshot(fx.entity_id, fx.specs, fx.readings, fx.live, {
    now: new Date(fx.now),
    gpu_online: fx.gpu_online,
    paused: fx.paused,
    snowline_m: null,
  });

  it("yields asleep, 'I can't feel my gauge', drought_class 1", () => {
    expect(snap.mood).toBe("asleep");
    expect(snap.mood_reason).toBe("I can't feel my gauge");
    expect(snap.drought_class).toBe(1);
    expect(snap.stale_driving).toBe(true);
    expect(snap.alert_level).toBe(0);
    expect(snap.season).toBe(2);
  });

  it("stale needs have health null; Gross Reservoir at 72 % is near normal / 0.8", () => {
    const by = Object.fromEntries(snap.needs.map((n) => [n.need, n]));
    expect(by.flow!.stale).toBe(true);
    expect(by.flow!.health).toBeNull();
    expect(by.flow!.staleness_s).toBe(118000);
    expect(by.flow!.label).toBe("15.4 cfs at Orodell, 2026-09-04 20:15Z, stale");
    expect(by.air!.health).toBeNull();
    expect(by.alerts!.source_status).toBe("critical");
    expect(by.storage!).toMatchObject({ value: 72, band: "near normal", health: 0.8, stale: false, trend_7d: "flat" });
    expect(by.storage!.label).toBe("72 % at Gross Reservoir, 2026-09-05 06:00Z");
    expect(by.drought!).toMatchObject({ band: "D1", health: 0.5, label: "D1, 2026-09-02 12:00Z" });
    expect(by.snow!.health).toBeNull(); // swe is unbanded: zero in September is normal, not broken
  });

  it("binds to the 'can't feel my gauge' Rive pose", () => {
    const ri = snapshotToRiveInputs(snap);
    expect(ri.mood).toBe(0);
    expect(ri.stale).toBe(true);
    expect(ri.drought).toBe(1);
    expect(ri.flow_pct).toBe(-1);
    expect(ri.headline_label).toBe("15.4 cfs at Orodell, 2026-09-04 20:15Z, stale");
  });

  it("stays asleep across the hysteresis window and wakes concerned (D1) two hours after the gauge returns", () => {
    const t1 = new Date(Date.parse(fx.now) + 3600_000);
    const fresh = { ...fx.readings };
    for (const k of Object.keys(fresh) as NeedName[]) fresh[k] = { ...fresh[k], stale: false, staleness_s: 600, source_status: "ok" };
    const h1 = computeSnapshot(fx.entity_id, fx.specs, fresh, fx.live, { now: t1, gpu_online: true, paused: false, previous_snapshots: [snap] });
    expect(h1.mood).toBe("asleep"); // held one hour
    const h2 = computeSnapshot(fx.entity_id, fx.specs, fresh, fx.live, { now: new Date(t1.getTime() + 3600_000), gpu_online: true, paused: false, previous_snapshots: [snap, h1] });
    expect(h2.mood).toBe("concerned");
    expect(h2.mood_reason).toBe("drought D1 in my watershed");
  });
});
