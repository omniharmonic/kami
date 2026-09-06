/**
 * `snapshotToRiveInputs` — the one binding from HealthSnapshot to the Rive
 * state machine inputs (architecture §9.2, B2 §12.8). One unit test per rule.
 *
 * Rules:
 *  1. `flow_pct` / `snow_pct` / `air_pct` = the `percentile` of the need named
 *     `flow` / `snow` / `air`, rounded to an integer 0–100; -1 when the need is
 *     absent, stale, or has no percentile. `air_pct` is the RAW percentile of
 *     the pollutant (high = more polluted than usual); it is not inverted,
 *     because the rig reads it as "how unusual is the air today" and the
 *     health/band already carry the good/bad direction. Documented here so
 *     nobody flips it in the rig without flipping it here.
 *  2. `temp_pct` = the percentile of a need named `temp` when the schema ever
 *     carries one (§9.1 has no such need today) — otherwise -1.
 *  3. `alert_level` 0–3 verbatim.
 *  4. `drought` = drought_class 0–4, -1 for null.
 *  5. `mood` enum: 0 asleep / 1 content / 2 concerned / 3 distressed / 4 celebrating.
 *  6. `stale` = stale_driving; `paused`, `gpu_online` verbatim.
 *  7. `season` 0–3 verbatim.
 *  8. `headline_label` = the anchor need's label (the first need in the
 *     binding), or "" when there are no needs.
 *  9. `cosmetic_<key>` = each cosmetics entry, numbers only.
 */

import type { HealthSnapshot, Mood, NeedSnapshot } from "./types.js";

export const MOOD_ENUM: Record<Mood, 0 | 1 | 2 | 3 | 4> = {
  asleep: 0,
  content: 1,
  concerned: 2,
  distressed: 3,
  celebrating: 4,
};

export type RiveInputs = {
  flow_pct: number;
  snow_pct: number;
  air_pct: number;
  temp_pct: number;
  alert_level: 0 | 1 | 2 | 3;
  drought: -1 | 0 | 1 | 2 | 3 | 4;
  mood: 0 | 1 | 2 | 3 | 4;
  stale: boolean;
  paused: boolean;
  gpu_online: boolean;
  season: 0 | 1 | 2 | 3;
  headline_label: string;
} & Record<`cosmetic_${string}`, number>;

/** percentile → 0–100 integer, or -1 when absent/stale/invalid. */
export function pctInput(need: NeedSnapshot | undefined): number {
  if (!need || need.stale) return -1;
  const p = need.percentile;
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 100) return -1;
  return Math.round(p);
}

export function snapshotToRiveInputs(snapshot: HealthSnapshot): RiveInputs {
  const byNeed = (name: string) => snapshot.needs.find((n) => (n.need as string) === name);

  const out: RiveInputs = {
    flow_pct: pctInput(byNeed("flow")),
    snow_pct: pctInput(byNeed("snow")),
    air_pct: pctInput(byNeed("air")),
    temp_pct: pctInput(byNeed("temp")),
    alert_level: snapshot.alert_level,
    drought: snapshot.drought_class === null ? -1 : snapshot.drought_class,
    mood: MOOD_ENUM[snapshot.mood],
    stale: snapshot.stale_driving,
    paused: snapshot.paused,
    gpu_online: snapshot.gpu_online,
    season: snapshot.season,
    headline_label: snapshot.needs[0]?.label ?? "",
  };

  for (const [key, value] of Object.entries(snapshot.cosmetics ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) out[`cosmetic_${key}`] = value;
  }
  return out;
}
