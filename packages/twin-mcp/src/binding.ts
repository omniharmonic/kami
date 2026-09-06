/**
 * The place-set binding (architecture §3): the set of twin ids an entity
 * senses through. Loaded from `--binding <file.yaml|json>`, validated against
 * `schemas/place-set-binding-1.0.json` and rules 1–6 against the live tree.
 * The server refuses to serve a binding that fails; warnings are reported and
 * served.
 */

import { readFile } from "node:fs/promises";
import { Ajv2020 as AjvCtor, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";
import { BINDING_SCHEMA, IDS_SCHEMA } from "./schemas.generated.js";
import type { TreeReader } from "./tree.js";
import type { Conditions, IdIndex, IdRecord, PlacePage } from "./types.js";

export type Role = "main_stem_gauge" | "gauge" | "snotel" | "reservoir" | "water_quality" | "air" | "weather" | "other";
export type Agg = "single" | "mean" | "median" | "min" | "max" | "mean_24h" | "max_intersecting";
export type Archetype = "creek" | "watershed" | "reservoir" | "mountain" | "bioregion";

export interface BindingMember {
  id: string;
  role: Role;
}
export interface BindingNeed {
  need: string;
  property: string;
  places: string[];
  agg: Agg;
  weight?: number;
}
export interface Binding {
  schema_version: "1.0";
  binding_version: number;
  entity_id: string;
  archetype: Archetype;
  anchor: string;
  stream_id?: string | null;
  commons_handle?: string | null;
  members: BindingMember[];
  watersheds: string[];
  reach_ids?: string[];
  boundary?: { geometry_urls?: string[] };
  needs: BindingNeed[];
  membership_rule?: string | null;
  frozen_at: string;
  reviewed_by?: string | null;
  twin_index_etag?: string | null;
}

export interface BindingResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  binding: Binding | null;
}

export const TWIN_ID = /^[a-z_]+\/[a-z0-9-]+$/;
export const ENTITY_ID = /^entity\/[a-z0-9-]+$/;

const WQ_PROPERTIES = ["water_temp", "specific_conductance", "dissolved_oxygen", "ph", "turbidity"];
const ROLE_REQUIRES: Record<Role, { any: string[]; kind?: string } | null> = {
  main_stem_gauge: { any: ["discharge"], kind: "monitoring_site" },
  gauge: { any: ["discharge", "stage", "gage_height"], kind: "monitoring_site" },
  snotel: { any: ["swe"] },
  reservoir: { any: ["reservoir_storage"] },
  water_quality: { any: WQ_PROPERTIES },
  air: { any: ["pm25", "ozone"] },
  weather: { any: ["air_temp", "rh", "wind_speed", "precip_accum", "precip_5min", "dewpoint"] },
  other: null,
};

let ajv: InstanceType<typeof AjvCtor> | null = null;
let validateBindingDoc: ValidateFunction | null = null;
let validateIdRecordFn: ValidateFunction | null = null;

function compiled() {
  if (!ajv) {
    ajv = new AjvCtor({ allErrors: true, strict: false });
    addFormats(ajv);
    validateBindingDoc = ajv.compile(BINDING_SCHEMA as unknown as object);
    validateIdRecordFn = ajv.compile(IDS_SCHEMA as unknown as object);
  }
  return { binding: validateBindingDoc!, idRecord: validateIdRecordFn! };
}

function fmt(errs: ErrorObject[] | null | undefined): string[] {
  return (errs ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
}

/** Validates an `id/<id>.json` record against the vendored ids-schema. */
export function validateIdRecord(rec: unknown): string[] {
  const v = compiled().idRecord;
  return v(rec) ? [] : fmt(v.errors);
}

/** Schema-only check of a binding document (rules 1–6 need the tree). */
export function validateBindingShape(doc: unknown): string[] {
  const v = compiled().binding;
  return v(doc) ? [] : fmt(v.errors);
}

export function parseBindingText(text: string, filename = "binding"): unknown {
  const trimmed = text.trim();
  if (filename.endsWith(".json") || trimmed.startsWith("{")) return JSON.parse(trimmed);
  return parseYaml(trimmed);
}

export async function loadBindingFile(path: string): Promise<unknown> {
  return parseBindingText(await readFile(path, "utf8"), path);
}

export function entitySlug(entity_id: string): string {
  return entity_id.replace(/^entity\//, "");
}

export function hucCodeOf(watershedId: string): string | null {
  const m = /^watershed\/huc\d+-(\d+)$/.exec(watershedId);
  return m ? m[1]! : null;
}

function allIds(b: Binding): string[] {
  const ids = new Set<string>([b.anchor, ...b.members.map((m) => m.id), ...b.watersheds, ...b.needs.flatMap((n) => n.places)]);
  if (b.stream_id) ids.add(b.stream_id);
  return [...ids];
}

/**
 * Rules 1–6 (architecture §3) against the tree. Never throws on a bad
 * binding; throws only when the tree itself cannot be read.
 */
export async function validateBinding(doc: unknown, reader: TreeReader): Promise<BindingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const shape = validateBindingShape(doc);
  if (shape.length) return { ok: false, errors: shape.map((e) => `schema: ${e}`), warnings, binding: null };
  const b = doc as Binding;

  // Rule 1 — every id matches the pattern and is in id/index.json.
  const index = await reader.getJson<IdIndex>("id/index.json");
  if (!index) return { ok: false, errors: ["id/index.json is not published at this tree"], warnings, binding: b };
  const byId = new Map(index.places.map((p) => [p.id, p]));
  for (const id of allIds(b)) {
    if (!TWIN_ID.test(id)) errors.push(`rule 1: id "${id}" does not match ^[a-z_]+/[a-z0-9-]+$`);
    else if (!byId.has(id)) errors.push(`rule 1: id "${id}" is not in id/index.json (superseded, withdrawn, or misspelt)`);
  }
  const memberIds = new Set(b.members.map((m) => m.id));
  if (!memberIds.has(b.anchor)) errors.push(`anchor "${b.anchor}" is not a member`);
  for (const n of b.needs) for (const p of n.places) if (!memberIds.has(p)) errors.push(`need "${n.need}": place "${p}" is not a member`);

  // Rule 2 — every id/<id>.json validates against ids-schema.
  const records = new Map<string, IdRecord>();
  for (const id of [...memberIds, ...b.watersheds]) {
    if (!byId.has(id)) continue;
    const rec = await reader.getJson<IdRecord>(`id/${id}.json`);
    if (!rec) {
      errors.push(`rule 2: id/${id}.json is not published (404)`);
      continue;
    }
    const errs = validateIdRecord(rec);
    if (errs.length) errors.push(`rule 2: id/${id}.json fails ids-schema: ${errs.join("; ")}`);
    else records.set(id, rec);
  }

  // Rule 3 — role constraints against latest/conditions.json datastreams.
  const conditions = await reader.getJson<Conditions>("latest/conditions.json");
  const streams = new Map<string, Set<string>>();
  if (conditions) for (const s of conditions.stations) streams.set(s.id, new Set(s.readings.map((r) => r.property)));
  for (const m of b.members) {
    const req = ROLE_REQUIRES[m.role];
    if (!req || !byId.has(m.id)) continue;
    const entry = byId.get(m.id)!;
    if (req.kind && entry.kind !== req.kind) errors.push(`rule 3: ${m.role} "${m.id}" must be kind ${req.kind}, is ${entry.kind}`);
    const have = streams.get(m.id);
    if (!conditions) {
      warnings.push(`rule 3: latest/conditions.json unavailable; role of "${m.id}" not checked`);
    } else if (!have || !req.any.some((p) => have.has(p))) {
      errors.push(`rule 3: ${m.role} "${m.id}" has no ${req.any.join("|")} datastream in latest/conditions.json`);
    }
  }
  for (const w of b.watersheds) {
    const entry = byId.get(w);
    if (entry && entry.kind !== "watershed") errors.push(`rule 3: watershed "${w}" is kind ${entry.kind}`);
  }

  // Rule 4 — sensitivity public|generalized; no boundary geometry from a generalized place.
  for (const [id, rec] of records) {
    if (rec.sensitivity && rec.sensitivity !== "public" && rec.sensitivity !== "generalized")
      errors.push(`rule 4: "${id}" has sensitivity ${rec.sensitivity}`);
  }
  for (const url of b.boundary?.geometry_urls ?? []) {
    const m = /\/geom\/([a-z_]+\/[a-z0-9-]+)\.geojson$/.exec(url);
    if (!m) {
      warnings.push(`rule 4: boundary geometry_url "${url}" is not a twin geom/ URL`);
      continue;
    }
    const id = m[1]!;
    let rec = records.get(id);
    if (!rec && byId.has(id)) rec = (await reader.getJson<IdRecord>(`id/${id}.json`)) ?? undefined;
    if (!rec) errors.push(`rule 4: boundary geometry_url "${url}" names "${id}", which has no id record`);
    else if (rec.sensitivity === "generalized") errors.push(`rule 4: boundary geometry_url "${url}" is a generalized place; a generalized place may supply readings but never a boundary`);
  }

  // Rule 5 — consistency warnings.
  const hucPrefixes = b.watersheds.map(hucCodeOf).filter((c): c is string => !!c);
  const huc12s = new Set<string>();
  for (const w of b.watersheds) {
    const page = await reader.getJson<PlacePage>(`latest/${w}.json`);
    for (const c of page?.children ?? []) {
      const code = hucCodeOf(c);
      if (code && code.length === 12) huc12s.add(code);
    }
    const rec = records.get(w);
    if (rec?.huc12) huc12s.add(rec.huc12);
  }
  if (hucPrefixes.length) {
    for (const m of b.members) {
      const h = byId.get(m.id)?.huc12 ?? records.get(m.id)?.huc12;
      if (!h) continue;
      const inside = huc12s.has(h) || hucPrefixes.some((p) => h.startsWith(p));
      if (!inside) warnings.push(`rule 5: member "${m.id}" huc12 ${h} lies outside the binding's watersheds`);
    }
  }
  for (const n of b.needs) {
    if (n.agg === "max_intersecting") {
      if (n.places.length) warnings.push(`rule 5: need "${n.need}" uses max_intersecting but lists places; the watersheds are used`);
      if (!b.watersheds.length) warnings.push(`rule 5: need "${n.need}" uses max_intersecting with no watersheds`);
      continue;
    }
    if (!n.places.length) {
      warnings.push(`rule 5: need "${n.need}" lists no places`);
      continue;
    }
    if (conditions && !n.places.some((p) => streams.get(p)?.has(n.property)))
      warnings.push(`rule 5: need "${n.need}": no ${n.property} reading today at ${n.places.join(", ")}`);
  }

  // Rule 6 — agg enum (also enforced by the schema).
  const AGGS: Agg[] = ["single", "mean", "median", "min", "max", "mean_24h", "max_intersecting"];
  for (const n of b.needs) if (!AGGS.includes(n.agg)) errors.push(`rule 6: need "${n.need}" agg "${n.agg}" not in {${AGGS.join(", ")}}`);
  for (const n of b.needs) if (n.agg === "single" && n.places.length > 1) warnings.push(`rule 6: need "${n.need}" is agg single with ${n.places.length} places; the first is used`);

  return { ok: errors.length === 0, errors, warnings, binding: b };
}

/**
 * A proposed binding for a twin watershed or stream id (`resolve_entity`):
 * members are the monitoring sites inside it that report today, roles are
 * inferred from their datastreams. `binding_version: 0` and no reviewer —
 * a proposal a steward must freeze, never a body.
 */
export async function proposeBinding(reader: TreeReader, twinId: string, now: number): Promise<Binding | null> {
  const index = await reader.getJson<IdIndex>("id/index.json");
  const entry = index?.places.find((p) => p.id === twinId);
  if (!index || !entry) return null;
  const page = await reader.getJson<PlacePage>(`latest/${twinId}.json`);
  const conditions = await reader.getJson<Conditions>("latest/conditions.json");
  const slug = twinId.split("/")[1]!;
  const members: BindingMember[] = [];
  const watersheds: string[] = [];
  let archetype: Archetype = "watershed";

  if (entry.kind === "watershed") {
    watersheds.push(twinId);
    const code = hucCodeOf(twinId);
    for (const s of conditions?.stations ?? []) {
      if (!code || !s.huc12?.startsWith(code)) continue;
      const props = new Set(s.readings.map((r) => r.property));
      const role: Role | null = props.has("discharge") ? "gauge" : props.has("swe") ? "snotel" : props.has("reservoir_storage") ? "reservoir"
        : WQ_PROPERTIES.some((p) => props.has(p)) ? "water_quality" : props.has("pm25") || props.has("ozone") ? "air"
        : props.has("air_temp") ? "weather" : null;
      if (role) members.push({ id: s.id, role });
    }
  } else if (entry.kind === "stream_reach" || entry.kind === "bioregion") {
    archetype = entry.kind === "bioregion" ? "bioregion" : "creek";
    for (const c of page?.children ?? []) {
      const kind = index.places.find((p) => p.id === c)?.kind;
      if (kind === "monitoring_site") members.push({ id: c, role: "main_stem_gauge" });
      else if (kind === "watershed") watersheds.push(c);
    }
    if (page?.parent_id && index.places.find((p) => p.id === page.parent_id)?.kind === "watershed") watersheds.push(page.parent_id);
  } else {
    return null;
  }
  if (members.length === 0) return null;
  members.sort((a, b) => a.id.localeCompare(b.id));
  const first = (role: Role) => members.find((m) => m.role === role)?.id;
  const anchor = first("main_stem_gauge") ?? first("gauge") ?? members[0]!.id;
  const needs: BindingNeed[] = [];
  const gauge = first("main_stem_gauge") ?? first("gauge");
  if (gauge) needs.push({ need: "flow", property: "discharge", places: [gauge], agg: "single" });
  if (first("reservoir")) needs.push({ need: "storage", property: "reservoir_fill", places: [first("reservoir")!], agg: "single" });
  if (first("snotel")) needs.push({ need: "snow", property: "swe", places: [first("snotel")!], agg: "single" });
  if (first("water_quality")) needs.push({ need: "water", property: "dissolved_oxygen", places: [first("water_quality")!], agg: "single" });
  if (first("air")) needs.push({ need: "air", property: "pm25", places: [first("air")!], agg: "mean_24h" });
  if (watersheds.length) needs.push({ need: "drought", property: "dm", places: [], agg: "max_intersecting" });
  const geometry_urls = watersheds.map((w) => `${reader.isRemote ? reader.base : "https://data.bioregionaltwin.org"}/geom/${w}.geojson`);
  return {
    schema_version: "1.0",
    binding_version: 0,
    entity_id: `entity/${slug}`,
    archetype,
    anchor,
    stream_id: entry.kind === "stream_reach" ? twinId : null,
    commons_handle: null,
    members,
    watersheds,
    reach_ids: [],
    boundary: { geometry_urls },
    needs,
    membership_rule: `proposed from ${twinId}: monitoring sites whose huc12 falls inside it and that report today`,
    frozen_at: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z"),
    reviewed_by: null,
    twin_index_etag: reader.etag("id/index.json"),
  };
}
