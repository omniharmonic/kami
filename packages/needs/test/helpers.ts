import type { HealthSnapshot, LiveInputs, NeedInput, NeedSpec, ComputeOptions, NeedName } from "../src/index.js";

export const NOW = new Date("2026-09-06T05:02:00Z");

export const SPECS: NeedSpec[] = [
  { need: "flow", property: "discharge", places: ["place/boulder-creek-near-orodell-co"], agg: "single", place_label: "Orodell" },
  { need: "storage", property: "reservoir_fill", places: ["place/gross-reservoir"], agg: "single", place_label: "Gross Reservoir" },
  { need: "snow", property: "swe", places: ["place/niwot"], agg: "single", place_label: "Niwot" },
  { need: "water", property: "dissolved_oxygen", places: ["place/south-boulder-cr-at-forebay-nr-eldorado-springs-co"], agg: "single", place_label: "the South Boulder forebay" },
  { need: "air", property: "pm25", places: ["place/boulder-cu-2102-athens-st"], agg: "mean_24h", place_label: "Athens St" },
  { need: "drought", property: "dm", places: [], agg: "max_intersecting" },
];

export function reading(over: Partial<NeedInput> = {}): NeedInput {
  return {
    value: 1,
    unit: null,
    time: "2026-09-06T04:00:00Z",
    source_id: "test.source",
    stale: false,
    staleness_s: 3720,
    source_status: "ok",
    ...over,
  };
}

/** Everything fine: fresh readings, storage near normal, air Good, drought null. */
export function healthyReadings(): Partial<Record<NeedName, NeedInput | null>> {
  return {
    flow: reading({ value: 15.4, unit: "[ft_i]3/s", source_id: "cdss.telemetry" }),
    storage: reading({ value: 85, unit: "%", source_id: "cdss.reservoirs" }),
    snow: reading({ value: 0, unit: "[in_i]", source_id: "nrcs.awdb" }),
    water: reading({ value: 8.1, unit: "mg/L", source_id: "usgs.iv" }),
    air: reading({ value: 5.5, unit: "ug/m3", source_id: "airnow" }),
    drought: null,
  };
}

export function live(over: Partial<LiveInputs> = {}): LiveInputs {
  return { drought_class: null, alerts: [], flood_category: null, fires_inside: 0, bounty_completed_in_24h: false, ...over };
}

export function opts(over: Partial<ComputeOptions> = {}): ComputeOptions {
  return { now: NOW, gpu_online: true, paused: false, ...over };
}

export function hourLater(o: ComputeOptions, hours = 1): Date {
  return new Date(o.now.getTime() + hours * 3600_000);
}

export type Snap = HealthSnapshot;
