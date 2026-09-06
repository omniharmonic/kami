import { describe, expect, it } from "vitest";
import type { HealthSnapshot, NeedSnapshot } from "@kami/needs";
import { deltasSince, describeDelta, hasNotableDelta, isNotableKind, notableOnly } from "../deltas";

function need(over: Partial<NeedSnapshot> = {}): NeedSnapshot {
  return {
    need: "flow",
    place_id: "place/boulder-creek-near-orodell-co",
    property: "discharge",
    value: 15.4,
    unit: "[ft_i]3/s",
    time: "2026-09-06T05:00:00Z",
    source_id: "cdss.telemetry",
    stale: false,
    staleness_s: 900,
    source_status: "ok",
    percentile: null,
    band: "normal",
    health: 0.7,
    trend_7d: "flat",
    label: "15.4 cfs at Orodell",
    ...over,
  };
}

function snap(over: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    schema_version: "1.0",
    entity_id: "entity/boulder-creek",
    as_of: "2026-09-06T06:00:00Z",
    needs: [need()],
    drought_class: 1,
    alert_level: 0,
    flood_category: null,
    stale_driving: false,
    mood: "concerned",
    mood_reason: "drought D1 in my watershed",
    season: 2,
    gpu_online: true,
    paused: false,
    cosmetics: {},
    ...over,
  };
}

describe("classifyDeltas / notable rules", () => {
  it("has no deltas against no previous snapshot", () => {
    expect(deltasSince(null, snap())).toEqual([]);
  });

  it("marks band changes, alert start/end, stale flips and mood changes notable", () => {
    const prev = snap();
    const band = deltasSince(prev, snap({ needs: [need({ band: "low", health: 0.2 })] }));
    expect(band.find((d) => d.kind === "band_change")).toMatchObject({ need: "flow", field: "band", from: "normal", to: "low", notable: true });

    const start = deltasSince(prev, snap({ alert_level: 3 }));
    expect(start.find((d) => d.kind === "alert_start")?.notable).toBe(true);
    const end = deltasSince(snap({ alert_level: 3 }), snap({ alert_level: 0 }));
    expect(end.find((d) => d.kind === "alert_end")?.notable).toBe(true);

    const stale = deltasSince(prev, snap({ needs: [need({ stale: true, health: null, band: "normal" })] }));
    expect(stale.find((d) => d.kind === "stale_flip")).toMatchObject({ from: false, to: true, notable: true });

    const mood = deltasSince(prev, snap({ mood: "asleep", mood_reason: "I can't feel my gauge" }));
    expect(mood.find((d) => d.kind === "mood_change")).toMatchObject({ from: "concerned", to: "asleep", notable: true });
    expect(hasNotableDelta(mood)).toBe(true);
  });

  it("does not mark a value move inside its band notable", () => {
    const deltas = deltasSince(snap(), snap({ needs: [need({ value: 15.1, label: "15.1 cfs at Orodell" })] }));
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ kind: "value_change", notable: false });
    expect(hasNotableDelta(deltas)).toBe(false);
    expect(notableOnly(deltas)).toEqual([]);
  });

  it("treats drought and flood class moves as band changes", () => {
    const d = deltasSince(snap(), snap({ drought_class: 2, flood_category: "action" }));
    expect(d.filter((x) => x.kind === "band_change").map((x) => x.field).sort()).toEqual(["drought_class", "flood_category"]);
    expect(hasNotableDelta(d)).toBe(true);
  });

  it("exposes the notable kind list and templated descriptions", () => {
    expect(isNotableKind("value_change")).toBe(false);
    expect(isNotableKind("stale_flip")).toBe(true);
    expect(describeDelta({ kind: "stale_flip", need: "flow", field: "stale", from: false, to: true, notable: true })).toBe("flow: gauge went quiet");
    expect(describeDelta({ kind: "mood_change", need: null, field: "mood", from: "content", to: "asleep", notable: true })).toBe("mood: content → asleep");
  });
});
