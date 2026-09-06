import { describe, expect, it } from "vitest";
import { MOOD_ENUM, computeSnapshot, snapshotToRiveInputs, type HealthSnapshot, type Mood } from "../src/index.js";
import { SPECS, healthyReadings, live, opts, reading } from "./helpers.js";

function snap(over: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return { ...computeSnapshot("entity/test", SPECS, healthyReadings(), live(), opts()), ...over };
}

describe("snapshotToRiveInputs — one test per rule", () => {
  it("rule 1: flow_pct / snow_pct / air_pct come from each need's percentile, rounded", () => {
    const r = healthyReadings();
    r.flow = reading({ ...r.flow!, context: { percentile: 12.6 } });
    r.snow = reading({ ...r.snow!, context: { percentile: 50 } });
    r.air = reading({ ...r.air!, context: { percentile: 88.4 } });
    const s = computeSnapshot("entity/test", SPECS, r, live(), opts());
    const ri = snapshotToRiveInputs(s);
    expect(ri.flow_pct).toBe(13);
    expect(ri.snow_pct).toBe(50);
    expect(ri.air_pct).toBe(88); // raw percentile, not inverted
  });

  it("rule 1: absent percentile → -1 on the input and health null on the need", () => {
    const s = snap();
    const ri = snapshotToRiveInputs(s);
    expect(ri.flow_pct).toBe(-1);
    expect(ri.snow_pct).toBe(-1);
    expect(ri.air_pct).toBe(-1);
    expect(s.needs.find((n) => n.need === "flow")!.health).toBeNull();
    expect(s.needs.find((n) => n.need === "flow")!.percentile).toBeNull();
  });

  it("rule 1: a stale need reports -1 even when it carries a percentile", () => {
    const r = healthyReadings();
    r.flow = reading({ ...r.flow!, stale: true, context: { percentile: 40 } });
    const ri = snapshotToRiveInputs(computeSnapshot("entity/test", SPECS, r, live(), opts()));
    expect(ri.flow_pct).toBe(-1);
  });

  it("rule 2: temp_pct is -1 when there is no temp need", () => {
    expect(snapshotToRiveInputs(snap()).temp_pct).toBe(-1);
  });

  it("rule 3: alert_level verbatim", () => {
    for (const lvl of [0, 1, 2, 3] as const) expect(snapshotToRiveInputs(snap({ alert_level: lvl })).alert_level).toBe(lvl);
  });

  it("rule 4: drought = drought_class, -1 for null", () => {
    expect(snapshotToRiveInputs(snap({ drought_class: null })).drought).toBe(-1);
    for (const dm of [0, 1, 2, 3, 4] as const) expect(snapshotToRiveInputs(snap({ drought_class: dm })).drought).toBe(dm);
  });

  it("rule 5: mood enum 0 asleep / 1 content / 2 concerned / 3 distressed / 4 celebrating", () => {
    const expected: Record<Mood, number> = { asleep: 0, content: 1, concerned: 2, distressed: 3, celebrating: 4 };
    for (const [mood, n] of Object.entries(expected) as [Mood, number][]) {
      expect(snapshotToRiveInputs(snap({ mood })).mood).toBe(n);
      expect(MOOD_ENUM[mood]).toBe(n);
    }
  });

  it("rule 6: stale = stale_driving; paused and gpu_online verbatim", () => {
    const ri = snapshotToRiveInputs(snap({ stale_driving: true, paused: true, gpu_online: false }));
    expect(ri.stale).toBe(true);
    expect(ri.paused).toBe(true);
    expect(ri.gpu_online).toBe(false);
    const ri2 = snapshotToRiveInputs(snap({ stale_driving: false, paused: false, gpu_online: true }));
    expect(ri2.stale).toBe(false);
    expect(ri2.paused).toBe(false);
    expect(ri2.gpu_online).toBe(true);
  });

  it("rule 7: season verbatim", () => {
    for (const s of [0, 1, 2, 3] as const) expect(snapshotToRiveInputs(snap({ season: s })).season).toBe(s);
  });

  it("rule 8: headline_label is the anchor (first) need's label; empty without needs", () => {
    const s = snap();
    expect(snapshotToRiveInputs(s).headline_label).toBe(s.needs[0]!.label);
    expect(snapshotToRiveInputs(s).headline_label).toMatch(/^15\.4 cfs at Orodell, 2026-09-06 04:00Z$/);
    expect(snapshotToRiveInputs(snap({ needs: [] })).headline_label).toBe("");
  });

  it("rule 9: cosmetics become cosmetic_<key> numbers", () => {
    const ri = snapshotToRiveInputs(snap({ cosmetics: { hat: 2, ribbon: 1 } }));
    expect(ri.cosmetic_hat).toBe(2);
    expect(ri.cosmetic_ribbon).toBe(1);
    expect(Object.keys(ri).filter((k) => k.startsWith("cosmetic_"))).toHaveLength(2);
  });
});
