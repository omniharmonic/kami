/**
 * `proposeBinding` — the platform's membership guess (PRD §4.2; T0.5).
 *
 * From `id/index.json`: watersheds whose name contains the query, collapsed
 * to the coarsest selected ancestors; every monitoring_site whose `huc12` is
 * a child of those watersheds, or whose place page says
 * `props.cdwr_stream_gnis_id === gnisId` (the STREAM's GNIS id — survey
 * §3.4). Roles come from the station's readings in `latest/conditions.json`.
 *
 * Output is deterministic for a given tree. It is a guess: `reviewed_by` is
 * null and the sidecar `provenance` says so. A steward freezes it.
 */

import type { Conditions, IdIndexEntry, PlacePage, Station, TwinClient } from "@kami/twin-client";

import { AIR_PROPERTIES, WATER_QUALITY_PROPERTIES, type Archetype, type Binding, type BindingMember, type BindingNeed, type MemberRole } from "./schema.js";

export const PROVENANCE = "platform guess — steward review required" as const;

export interface ProposeOptions {
  /** Case-insensitive substring matched against watershed and station names, e.g. "Boulder Creek". */
  query: string;
  tree: TwinClient;
  /** The stream's GNIS id, e.g. "00178354" for Boulder Creek. */
  gnisId?: string;
  archetype?: Archetype;
  /** Overrides the slug derived from the query. */
  slug?: string;
  /** Clock for `frozen_at`. Defaults to now. */
  now?: Date;
  /** Twin origin used to template geometry URLs when an id record lacks one. */
  baseUrl?: string;
}

export interface Proposal {
  binding: Binding;
  provenance: typeof PROVENANCE;
  stats: {
    watersheds: number;
    huc12s: number;
    candidates: number;
    members: number;
    /** Stations in the HUC-12 set that carry no reading today and were left out. */
    silent: number;
  };
  notes: string[];
}

const HUC12_CHILD = /^watershed\/huc12-(\d{12})$/;
const ROLE_ORDER: MemberRole[] = ["main_stem_gauge", "gauge", "snotel", "reservoir", "water_quality", "air", "weather", "other"];
const WEATHER = new Set(["air_temp", "dewpoint", "rh", "wind_speed", "wind_gust", "wind_dir", "pressure", "precip_1h", "precip_5min", "solar_rad", "visibility"]);

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function propStr(page: PlacePage | undefined, key: string): string | undefined {
  const v = page?.props?.[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}

function classify(props: Set<string>, nameMatches: boolean, gnisMatches: boolean): MemberRole {
  if (props.has("discharge") && (nameMatches || gnisMatches)) return "main_stem_gauge";
  if (props.has("discharge")) return "gauge";
  if (props.has("swe")) return "snotel";
  if (props.has("reservoir_storage")) return "reservoir";
  if (WATER_QUALITY_PROPERTIES.some((p) => props.has(p))) return "water_quality";
  if (AIR_PROPERTIES.some((p) => props.has(p))) return "air";
  if ([...props].some((p) => WEATHER.has(p))) return "weather";
  return "other";
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export async function proposeBinding(options: ProposeOptions): Promise<Proposal> {
  const { query, tree, gnisId } = options;
  const needle = query.toLowerCase();
  const notes: string[] = [];
  const baseUrl = (options.baseUrl ?? tree.baseUrl).replace(/\/+$/, "");

  const indexRes = await tree.index();
  if (!indexRes) throw new Error("id/index.json is not available; cannot propose a binding");
  const index = indexRes.data.places;
  const entryById = new Map(index.map((p) => [p.id, p] as const));

  // --- watersheds: name match, collapsed to the coarsest selected ancestors ----
  const matched = index.filter((p) => p.kind === "watershed" && p.name.toLowerCase().includes(needle)).sort(byId);
  const pages = new Map<string, PlacePage>();
  for (const w of matched) {
    const page = await tree.placePage(w.id);
    if (page) pages.set(w.id, page.data);
  }
  const matchedIds = new Set(matched.map((w) => w.id));
  const isDescendantOfSelected = (id: string): boolean => {
    let parent = pages.get(id)?.parent_id ?? null;
    const guard = new Set<string>();
    while (parent && !guard.has(parent)) {
      if (matchedIds.has(parent)) return true;
      guard.add(parent);
      parent = pages.get(parent)?.parent_id ?? null;
    }
    return false;
  };
  const watersheds = matched.filter((w) => !isDescendantOfSelected(w.id));
  if (watersheds.length !== matched.length) {
    notes.push(`${matched.length - watersheds.length} matching HUC-12 watershed(s) folded into their selected parents`);
  }

  // the HUC-12 set = the selected watersheds' own codes + their huc12 children
  const huc12s = new Set<string>();
  for (const w of watersheds) {
    if (w.huc12) huc12s.add(w.huc12);
    for (const child of pages.get(w.id)?.children ?? []) {
      const m = HUC12_CHILD.exec(child);
      if (m) huc12s.add(m[1]!);
    }
  }
  const huc8s = new Set([...huc12s].map((h) => h.slice(0, 8)));

  // --- candidate stations ------------------------------------------------------------
  const conditionsRes = await tree.conditions();
  if (!conditionsRes) throw new Error("latest/conditions.json is not available; cannot classify roles");
  const conditions: Conditions = conditionsRes.data;
  const stationById = new Map<string, Station>(conditions.stations.map((s) => [s.id, s]));

  const sites = index.filter((p) => p.kind === "monitoring_site").sort(byId);
  const inSet = sites.filter((p) => p.huc12 !== undefined && huc12s.has(p.huc12));
  // the GNIS rule can reach outside the HUC set; bound the page scan to the same HUC-8s
  const gnisScan = gnisId ? sites.filter((p) => !inSet.includes(p) && p.huc12 !== undefined && huc8s.has(p.huc12.slice(0, 8))) : [];

  interface Candidate {
    entry: IdIndexEntry;
    page: PlacePage | undefined;
    station: Station | undefined;
    role: MemberRole;
    gnis: boolean;
  }
  const candidates: Candidate[] = [];
  let silent = 0;
  const consider = async (entry: IdIndexEntry, requireGnis: boolean) => {
    const station = stationById.get(entry.id);
    const page = (await tree.placePage(entry.id))?.data;
    const gnis = gnisId !== undefined && propStr(page, "cdwr_stream_gnis_id") === gnisId;
    if (requireGnis && !gnis) return;
    if (!station) {
      silent++;
      return;
    }
    const props = new Set(station.readings.map((r) => r.property));
    const role = classify(props, entry.name.toLowerCase().includes(needle), gnis);
    candidates.push({ entry, page, station, role, gnis });
  };
  for (const e of inSet) await consider(e, false);
  for (const e of gnisScan) await consider(e, true);
  if (silent > 0) notes.push(`${silent} station(s) in the HUC-12 set carry no reading today and were left out`);

  // --- ordering -------------------------------------------------------------------------------
  const downstreamKey = (c: Candidate) => `${propStr(c.page, "cdwr_huc10") ?? "~"}|${c.entry.huc12 ?? "~"}|${c.entry.id}`;
  const mainStem = candidates.filter((c) => c.role === "main_stem_gauge").sort((a, b) => downstreamKey(a).localeCompare(downstreamKey(b)));
  const rest = candidates.filter((c) => c.role !== "main_stem_gauge");
  const ordered: Candidate[] = [...mainStem];
  for (const role of ROLE_ORDER.slice(1)) ordered.push(...rest.filter((c) => c.role === role).sort((a, b) => byId(a.entry, b.entry)));

  const members: BindingMember[] = ordered.map((c) => ({ id: c.entry.id, role: c.role, name: c.entry.name.trim() }));

  // --- anchor: the main-stem gauge with the longest record, else the first -------
  const anchorCandidate =
    [...mainStem].sort((a, b) => {
      const pa = propStr(a.page, "cdwr_por_start") ?? "9999";
      const pb = propStr(b.page, "cdwr_por_start") ?? "9999";
      return pa < pb ? -1 : pa > pb ? 1 : downstreamKey(a).localeCompare(downstreamKey(b));
    })[0] ?? ordered[0];
  if (!anchorCandidate) throw new Error(`no station with a reading today matches ${JSON.stringify(query)}`);
  const anchor = anchorCandidate.entry.id;
  if (mainStem.length === 0) notes.push("no main-stem gauge found; anchor is the first member by role order");

  // --- needs -----------------------------------------------------------------------------------
  const has = (c: Candidate, p: string) => c.station!.readings.some((r) => r.property === p);
  const capacity = (c: Candidate) => {
    const v = c.station!.props?.capacity_af;
    return typeof v === "number" ? v : -1;
  };
  const needs: BindingNeed[] = [];
  if (mainStem.length > 0) needs.push({ need: "flow", property: "discharge", places: [anchor], agg: "single", weight: 1 });
  const reservoirs = ordered.filter((c) => c.role === "reservoir");
  const withFill = reservoirs.filter((c) => has(c, "reservoir_fill")).sort((a, b) => capacity(b) - capacity(a) || byId(a.entry, b.entry));
  const storage = withFill[0] ?? reservoirs[0];
  if (storage) needs.push({ need: "storage", property: withFill[0] ? "reservoir_fill" : "reservoir_storage", places: [storage.entry.id], agg: "single", weight: 1 });
  const snotel = ordered.find((c) => c.role === "snotel");
  if (snotel) needs.push({ need: "snow", property: "swe", places: [snotel.entry.id], agg: "single", weight: 0.5 });
  const wq = ordered.find((c) => c.role === "water_quality");
  if (wq) {
    const property = has(wq, "dissolved_oxygen") ? "dissolved_oxygen" : (WATER_QUALITY_PROPERTIES.find((p) => has(wq, p)) ?? "dissolved_oxygen");
    needs.push({ need: "water", property, places: [wq.entry.id], agg: "single", weight: 0.5 });
  }
  const air = ordered.find((c) => c.role === "air");
  if (air) needs.push({ need: "air", property: has(air, "pm25") ? "pm25" : "ozone", places: [air.entry.id], agg: "mean_24h", weight: 0.5 });
  needs.push({ need: "drought", property: "dm", places: [], agg: "max_intersecting", weight: 1 });

  // --- boundary URLs from the watersheds' id records (public only — rule 4) ---
  const geometry_urls: string[] = [];
  for (const w of watersheds) {
    const rec = (await tree.idRecord(w.id))?.data;
    if (rec?.sensitivity === "generalized") {
      notes.push(`${w.id} is generalized and was left out of boundary.geometry_urls`);
      continue;
    }
    geometry_urls.push(rec?.geometry_url ?? `${baseUrl}/geom/${w.id}.geojson`);
  }

  const slug = options.slug ?? slugify(query);
  const membership_rule = gnisId
    ? `watershed name contains '${query}' + props.cdwr_stream_gnis_id == '${gnisId}'`
    : `watershed name contains '${query}'`;

  const binding: Binding = {
    schema_version: "1.0",
    binding_version: 1,
    entity_id: `entity/${slug}`,
    archetype: options.archetype ?? "creek",
    anchor,
    stream_id: null,
    commons_handle: `wiki/places/named/${slug}`,
    members,
    watersheds: watersheds.map((w) => w.id),
    reach_ids: [],
    boundary: { geometry_urls },
    needs,
    membership_rule,
    frozen_at: isoSeconds(options.now ?? new Date()),
    reviewed_by: null,
    twin_index_etag: indexRes.meta.etag,
  };

  void entryById;
  return {
    binding,
    provenance: PROVENANCE,
    stats: { watersheds: watersheds.length, huc12s: huc12s.size, candidates: candidates.length + silent, members: members.length, silent },
    notes,
  };
}
