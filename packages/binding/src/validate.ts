/**
 * `validateBinding` — architecture §3, rules 1–6, against a twin tree.
 *
 * 1. every id matches `^[a-z_]+/[a-z0-9-]+$` and is in `id/index.json`
 * 2. every `id/<id>.json` validates against the twin's ids-schema
 *    (`additionalProperties: false`)
 * 3. role constraints against `latest/conditions.json` datastreams
 * 4. sensitivity public|generalized only; a generalized place never supplies
 *    a `boundary.geometry_urls` entry
 * 5. warnings: a member's huc12 outside the watersheds' HUC-12 set; a need
 *    whose property has no reading today
 * 6. `needs[].agg` in the enum
 *
 * Errors block a save; warnings are shown to the steward. The same rules run
 * in the twin MCP on load (`packages/twin-mcp`), against the same schema.
 */

import type { IdIndexEntry, IdRecord, TwinClient } from "@kami/twin-client";

import { checkBindingShape, idRecordValidator, formatAjvErrors } from "./load.js";
import {
  AGGS,
  AIR_PROPERTIES,
  PLACE_ID_PATTERN,
  WATER_QUALITY_PROPERTIES,
  type Agg,
  type Binding,
  type MemberRole,
} from "./schema.js";

export type Rule = 1 | 2 | 3 | 4 | 5 | 6 | "schema";

export interface ValidationIssue {
  rule: Rule;
  /** JSON pointer into the binding, e.g. "/members/3/id". */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface IdRef {
  id: string;
  path: string;
}

const HUC12_CHILD = /^watershed\/huc12-(\d{12})$/;
const GEOM_URL = /\/geom\/([a-z_]+\/[a-z0-9-]+)\.geojson$/;

/** Every id the binding references, with the pointer to its first occurrence. */
export function referencedIds(b: Partial<Binding>): IdRef[] {
  const refs: IdRef[] = [];
  const seen = new Set<string>();
  const add = (id: unknown, path: string) => {
    if (typeof id !== "string" || seen.has(id)) return;
    seen.add(id);
    refs.push({ id, path });
  };
  add(b.anchor, "/anchor");
  if (b.stream_id !== null) add(b.stream_id, "/stream_id");
  (b.members ?? []).forEach((m, i) => add(m?.id, `/members/${i}/id`));
  (b.watersheds ?? []).forEach((w, i) => add(w, `/watersheds/${i}`));
  (b.needs ?? []).forEach((n, i) => (n?.places ?? []).forEach((p, j) => add(p, `/needs/${i}/places/${j}`)));
  return refs;
}

/** Required reading properties per role (rule 3). Roles absent here are unconstrained. */
export const ROLE_REQUIREMENTS: Partial<Record<MemberRole, { anyOf: readonly string[]; label: string }>> = {
  main_stem_gauge: { anyOf: ["discharge"], label: "a discharge datastream" },
  snotel: { anyOf: ["swe"], label: "an swe datastream" },
  reservoir: { anyOf: ["reservoir_storage"], label: "a reservoir_storage datastream" },
  water_quality: { anyOf: WATER_QUALITY_PROPERTIES, label: `one of ${WATER_QUALITY_PROPERTIES.join("/")}` },
  air: { anyOf: AIR_PROPERTIES, label: "pm25 or ozone" },
};

export async function validateBinding(binding: unknown, tree: TwinClient): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const err = (rule: Rule, path: string, message: string) => errors.push({ rule, path, message });
  const warn = (rule: Rule, path: string, message: string) => warnings.push({ rule, path, message });

  // --- shape (schema) and rule 6 -----------------------------------------
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    return { ok: false, errors: [{ rule: "schema", path: "/", message: "binding is not an object" }], warnings };
  }
  const b = binding as Partial<Binding>;
  for (const issue of checkBindingShape(binding)) {
    if (/^\/needs\/\d+\/agg$/.test(issue.path)) continue; // reported by rule 6 below
    err("schema", issue.path, issue.message);
  }
  (b.needs ?? []).forEach((n, i) => {
    if (!AGGS.includes(n?.agg as Agg)) err(6, `/needs/${i}/agg`, `agg must be one of ${AGGS.join("|")}; got ${JSON.stringify(n?.agg)}`);
  });

  // --- rule 1: pattern + presence in id/index.json --------------------------
  const indexRes = await tree.index();
  if (!indexRes) {
    err(1, "/", "id/index.json is not available; cannot verify any id");
    return { ok: false, errors, warnings };
  }
  const index = new Map<string, IdIndexEntry>(indexRes.data.places.map((p) => [p.id, p]));
  const refs = referencedIds(b);
  const known: IdRef[] = [];
  for (const ref of refs) {
    if (!PLACE_ID_PATTERN.test(ref.id)) {
      err(1, ref.path, `${JSON.stringify(ref.id)} does not match ^[a-z_]+/[a-z0-9-]+$`);
    } else if (!index.has(ref.id)) {
      err(1, ref.path, `${ref.id} is not in id/index.json (never published, pruned, or superseded)`);
    } else {
      known.push(ref);
    }
  }

  // --- rule 2: id records against ids-schema ---------------------------------
  const validateId = idRecordValidator();
  const records = new Map<string, IdRecord>();
  for (const ref of known) {
    const rec = await tree.idRecord(ref.id);
    if (!rec) {
      err(2, ref.path, `id/${ref.id}.json is missing although the index lists it`);
      continue;
    }
    if (!validateId(rec.data)) {
      for (const i of formatAjvErrors(validateId.errors)) {
        err(2, ref.path, `id/${ref.id}.json fails ids-schema at ${i.path}: ${i.message}`);
      }
    }
    records.set(ref.id, rec.data);
  }

  // --- rule 3: role constraints against conditions.json --------------------
  const conditionsRes = await tree.conditions();
  const props = new Map<string, Set<string>>();
  if (conditionsRes) {
    for (const s of conditionsRes.data.stations) props.set(s.id, new Set(s.readings.map((r) => r.property)));
  } else {
    err(3, "/", "latest/conditions.json is not available; role constraints cannot be checked");
  }
  (b.members ?? []).forEach((m, i) => {
    if (!m || !index.has(m.id)) return;
    const path = `/members/${i}`;
    const entry = index.get(m.id)!;
    const req = ROLE_REQUIREMENTS[m.role];
    if (!req) return;
    if (m.role === "main_stem_gauge" && entry.kind !== "monitoring_site") {
      err(3, path, `main_stem_gauge requires kind monitoring_site; ${m.id} is ${entry.kind}`);
    }
    if (!conditionsRes) return;
    const have = props.get(m.id);
    if (!have) {
      err(3, path, `${m.role} requires ${req.label}; ${m.id} has no readings in latest/conditions.json today`);
    } else if (!req.anyOf.some((p) => have.has(p))) {
      err(3, path, `${m.role} requires ${req.label}; ${m.id} has [${[...have].sort().join(", ")}]`);
    }
  });
  (b.watersheds ?? []).forEach((w, i) => {
    const entry = index.get(w);
    if (entry && entry.kind !== "watershed") err(3, `/watersheds/${i}`, `${w} is kind ${entry.kind}, not watershed`);
  });

  // --- rule 4: sensitivity ------------------------------------------------------------
  for (const ref of known) {
    const rec = records.get(ref.id);
    if (!rec) continue;
    if (rec.sensitivity === undefined) {
      warn(4, ref.path, `${ref.id} publishes no sensitivity; treating as unknown`);
    } else if (rec.sensitivity !== "public" && rec.sensitivity !== "generalized") {
      err(4, ref.path, `${ref.id} has sensitivity ${JSON.stringify(rec.sensitivity)}; only public|generalized exist on the wire`);
    }
  }
  const urls = b.boundary?.geometry_urls ?? [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!;
    const path = `/boundary/geometry_urls/${i}`;
    const m = GEOM_URL.exec(url);
    if (!m) {
      err(4, path, `${url} is not a twin geom URL (…/geom/<ns>/<slug>.geojson)`);
      continue;
    }
    const id = m[1]!;
    const rec = records.get(id) ?? (index.has(id) ? (await tree.idRecord(id))?.data : undefined);
    if (!rec) {
      err(4, path, `${id} is not a published place; it cannot supply a boundary geometry`);
      continue;
    }
    if (rec.sensitivity === "generalized") {
      err(4, path, `${id} is generalized; a generalized place may supply readings but never a boundary geometry`);
    }
    if (rec.geometry_url && rec.geometry_url !== url) {
      warn(4, path, `${url} differs from the record's geometry_url ${rec.geometry_url}`);
    }
  }

  // --- rule 5: consistency warnings ------------------------------------------------
  const huc12s = new Set<string>();
  for (const w of b.watersheds ?? []) {
    const entry = index.get(w);
    if (!entry) continue;
    if (entry.huc12) huc12s.add(entry.huc12);
    const page = await tree.placePage(w);
    for (const child of page?.data.children ?? []) {
      const cm = HUC12_CHILD.exec(child);
      if (cm) huc12s.add(cm[1]!);
    }
  }
  if (huc12s.size > 0) {
    (b.members ?? []).forEach((m, i) => {
      const entry = m && index.get(m.id);
      if (entry?.huc12 && !huc12s.has(entry.huc12)) {
        warn(5, `/members/${i}/id`, `${m.id} sits in HUC-12 ${entry.huc12}, outside the watersheds' HUC-12 set`);
      }
    });
  }
  for (let i = 0; i < (b.needs ?? []).length; i++) {
    const n = b.needs![i]!;
    const path = `/needs/${i}/property`;
    if (n.places.length > 0) {
      if (!conditionsRes) continue;
      const anyToday = n.places.some((p) => props.get(p)?.has(n.property));
      if (!anyToday) warn(5, path, `no ${n.property} reading today at ${n.places.join(", ")}`);
    } else if (n.property === "dm") {
      const drought = await tree.live("drought");
      if (!drought || drought.data.features.length === 0) warn(5, path, "latest/drought.geojson has no polygons today");
    } else {
      warn(5, path, `${n.property} has no places and is not a live-layer property`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
