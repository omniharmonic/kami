/**
 * "What this kami would be able to sense today" — one row per need of the
 * proposed binding, computed from `latest/conditions.json`, the live layers,
 * and `normals/<id>.json` (which the twin does not publish yet, survey §2.7).
 *
 * The honest-gap rule (PRD §12 #1, risk 11): a gap is *named*, never filled.
 * "no percentile is published for flow yet" is a row, not a silence.
 */
import type { Binding, BindingNeed } from "@kami/binding";
import { TwinUnreachable, readingStaleness, type Reading, type Station, type TwinClient } from "@kami/twin-client";
import { summon } from "./copy";

export type NeedState = "live" | "stale" | "missing";

export type SensingRow = {
  need: string;
  property: string;
  /** place ids the need reads through; empty for a live-layer need such as drought */
  places: string[];
  /** human labels for those places, when the binding carries them */
  where: string[];
  agg: string;
  state: NeedState;
  /** ISO time of the newest reading behind this need, when there is one */
  time: string | null;
  unit: string | null;
  value: number | null;
  staleness_s: number | null;
  source_id: string | null;
  /** true when the twin publishes a baseline for this need's anchor place */
  percentile_available: boolean;
  /** one sentence, written not generated */
  note: string;
};

export type SensingReport = {
  rows: SensingRow[];
  /** every gap worth showing the creator before they invest any effort */
  gaps: string[];
  /** conditions.json generated_at, so the page can say how fresh this is */
  as_of: string | null;
  /** true when the twin could not be reached at all; the rows are then empty */
  unreachable: boolean;
};

function newest(readings: Reading[], property: string): Reading | null {
  const matching = readings.filter((r) => r.property === property);
  if (matching.length === 0) return null;
  return matching.reduce((a, b) => ((Date.parse(b.time ?? "") || 0) > (Date.parse(a.time ?? "") || 0) ? b : a));
}

function stateOf(reading: Reading | null, now: number): { state: NeedState; staleness_s: number | null } {
  if (!reading) return { state: "missing", staleness_s: null };
  const s = readingStaleness(reading, now);
  if (s.unknown && s.seconds === null) return { state: "missing", staleness_s: null };
  return { state: s.stale ? "stale" : "live", staleness_s: s.seconds === null ? null : Math.round(s.seconds) };
}

/** `place/gross-reservoir` → the binding's own label, else the twin's station name, else the id. */
function labelFor(binding: Binding, station: Station | undefined, id: string): string {
  const member = binding.members.find((m) => m.id === id);
  return (member?.name ?? station?.name ?? id).trim();
}

export async function describeSensing(binding: Binding, tree: TwinClient, now = Date.now()): Promise<SensingReport> {
  let conditions;
  try {
    conditions = await tree.conditions();
  } catch (err) {
    if (err instanceof TwinUnreachable) return { rows: [], gaps: [summon.place.unreachable], as_of: null, unreachable: true };
    throw err;
  }
  if (!conditions) return { rows: [], gaps: [summon.place.unreachable], as_of: null, unreachable: true };

  const byId = new Map<string, Station>(conditions.data.stations.map((s) => [s.id, s]));
  const rows: SensingRow[] = [];
  const gaps: string[] = [];

  for (const need of binding.needs as BindingNeed[]) {
    const where: string[] = [];
    let best: { reading: Reading; place: string } | null = null;
    for (const id of need.places) {
      const station = byId.get(id);
      where.push(labelFor(binding, station, id));
      const reading = station ? newest(station.readings, need.property) : null;
      if (reading && (!best || (Date.parse(reading.time ?? "") || 0) > (Date.parse(best.reading.time ?? "") || 0))) {
        best = { reading, place: id };
      }
    }

    let { state, staleness_s } = stateOf(best?.reading ?? null, now);
    let note: string;
    if (need.places.length === 0) {
      // drought and the other live-layer needs: check the layer itself
      const layerOk = await liveLayerHasFeatures(tree, need.property);
      state = layerOk ? "live" : "missing";
      note = layerOk ? summon.sensing.noPlaces(need.need) : `${summon.sensing.noPlaces(need.need)}; that layer has nothing published today`;
      if (!layerOk) gaps.push(`${need.need}: the live layer has no features today, so this need starts unknown`);
    } else if (state === "missing") {
      note = `no ${need.property} reading at ${where.join(", ")} today — absent means unknown, never zero`;
      gaps.push(`${need.need}: ${summon.sensing.missing} at ${where.join(", ")}`);
    } else if (state === "stale") {
      note = `the last ${need.property} reading is old; a stale driving need puts the kami to sleep rather than making it sad`;
      gaps.push(`${need.need}: ${summon.sensing.stale} at ${where.join(", ")}`);
    } else {
      note = `${need.property} is published today at ${where.join(", ")}`;
    }

    // Baselines (TW-5) are not published yet: without them the kami may never
    // call a reading low or high for the season. Say so, per need.
    const anchorPlace = best?.place ?? need.places[0] ?? null;
    const percentile_available = anchorPlace ? await hasNormals(tree, anchorPlace) : false;
    if (!percentile_available && need.places.length > 0) {
      const line = summon.sensing.noPercentile(need.need);
      note = `${note}; ${line}`;
      gaps.push(line);
    }

    rows.push({
      need: need.need,
      property: need.property,
      places: [...need.places],
      where,
      agg: need.agg,
      state,
      time: best?.reading.time ?? null,
      unit: best?.reading.unit ?? null,
      value: typeof best?.reading.value === "number" ? best.reading.value : null,
      staleness_s,
      source_id: best?.reading.source_id ?? null,
      percentile_available,
      note,
    });
  }

  return { rows, gaps: [...new Set(gaps)], as_of: conditions.data.generated_at ?? conditions.meta.generated_at, unreachable: false };
}

const LIVE_LAYERS = new Set(["dm", "drought"]);

async function liveLayerHasFeatures(tree: TwinClient, property: string): Promise<boolean> {
  if (!LIVE_LAYERS.has(property)) return false;
  try {
    const res = await tree.live("drought");
    return Boolean(res && res.data.features.length > 0);
  } catch (err) {
    if (err instanceof TwinUnreachable) return false;
    throw err;
  }
}

async function hasNormals(tree: TwinClient, placeId: string): Promise<boolean> {
  try {
    return (await tree.normals(placeId)) !== null;
  } catch (err) {
    if (err instanceof TwinUnreachable) return false;
    // A tree that publishes `normals/` in a shape we cannot type is a contract
    // break, not a reason to claim a percentile exists.
    return false;
  }
}
