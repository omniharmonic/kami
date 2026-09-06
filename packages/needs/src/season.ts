/**
 * Season for the avatar (architecture §9.1): 0 freeze, 1 runoff, 2 monsoon,
 * 3 fall. Calibrated for the Colorado Front Range (~40° N); the `lat`
 * argument documents that assumption and is otherwise unused.
 *
 * The date decides. The snowline from `latest/snow.json` only nudges the two
 * edges where the Front Range is genuinely ambiguous:
 *
 *  - March → runoff early when the snowline has already climbed above
 *    `RUNOFF_SNOWLINE_M` (melt is under way on the foothills).
 *  - April → freeze still when the snowline is reported below
 *    `FREEZE_SNOWLINE_M` (snow is still on the plains; nothing is running).
 *  - October → freeze early when a snowline is reported below
 *    `FREEZE_SNOWLINE_M` (the first low snow has arrived and stayed).
 *
 * A null snowline (unknown, or no snow) never nudges. Months are read in UTC;
 * a day either side of a month boundary is not worth a timezone dependency.
 *
 * *verify*: the two thresholds are a first guess; tune against a winter of
 * `latest/snow.json` once the twin has one.
 */

import type { Season } from "./types.js";

export const RUNOFF_SNOWLINE_M = 2400;
export const FREEZE_SNOWLINE_M = 2000;

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function season(date: Date, snowline_m: number | null | undefined = null, lat = 40): Season {
  void lat; // rules are Front Range rules; see header
  const month = date.getUTCMonth() + 1; // 1–12
  const snow = finite(snowline_m) ? snowline_m : null;

  if (month === 3 && snow !== null && snow >= RUNOFF_SNOWLINE_M) return 1;
  if (month === 4 && snow !== null && snow < FREEZE_SNOWLINE_M) return 0;
  if (month === 10 && snow !== null && snow < FREEZE_SNOWLINE_M) return 0;

  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month === 10) return 3;
  return 0; // Nov–Mar
}

export const SEASON_NAMES: Record<Season, "freeze" | "runoff" | "monsoon" | "fall"> = {
  0: "freeze",
  1: "runoff",
  2: "monsoon",
  3: "fall",
};
