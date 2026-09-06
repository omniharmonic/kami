/**
 * `checkSupersession` — the nightly `binding-check` (architecture §3, "When
 * the twin supersedes a place").
 *
 * The twin keeps a retired page with `superseded_by` and drops the id from
 * `id/index.json` (survey §1.5). For every member we fetch `latest/<id>.json`:
 *   - `superseded_by` present → the need is `stale` with `reason: superseded`
 *     and a new binding version is drafted with the successor substituted;
 *   - page gone with no successor → the need is `missing` (page a steward).
 * The draft is `reviewed_by: null` — it waits for a steward. The entity
 * meanwhile says a templated line, never a model's.
 */

import type { TwinClient } from "@kami/twin-client";

import type { Binding, MemberRole } from "./schema.js";

export interface SupersessionFinding {
  id: string;
  role: MemberRole | "anchor" | "watershed";
  state: "stale" | "missing";
  reason?: "superseded";
  successor?: string;
  /** Names of needs that read this id. */
  needs: string[];
}

export interface SupersessionResult {
  /** Present only when at least one member has a published successor. */
  draft?: Binding;
  findings: SupersessionFinding[];
}

export interface SupersessionOptions {
  /** Clock for the draft's `frozen_at`. Defaults to now. */
  now?: Date;
}

function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function checkSupersession(
  binding: Binding,
  tree: TwinClient,
  options: SupersessionOptions = {},
): Promise<SupersessionResult> {
  const findings: SupersessionFinding[] = [];
  const successors = new Map<string, string>();

  const targets: { id: string; role: SupersessionFinding["role"] }[] = binding.members.map((m) => ({ id: m.id, role: m.role }));
  if (!binding.members.some((m) => m.id === binding.anchor)) targets.push({ id: binding.anchor, role: "anchor" });
  for (const w of binding.watersheds) targets.push({ id: w, role: "watershed" });

  const seen = new Set<string>();
  for (const t of targets) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const page = await tree.placePage(t.id);
    const needs = binding.needs.filter((n) => n.places.includes(t.id)).map((n) => n.need);
    if (!page) {
      findings.push({ id: t.id, role: t.role, state: "missing", needs });
      continue;
    }
    const successor = page.data.superseded_by;
    if (typeof successor === "string" && successor.length > 0) {
      successors.set(t.id, successor);
      findings.push({ id: t.id, role: t.role, state: "stale", reason: "superseded", successor, needs });
    }
  }

  if (successors.size === 0) return { findings };

  const swap = (id: string) => successors.get(id) ?? id;
  const swapUrl = (url: string) => {
    for (const [old, next] of successors) url = url.replace(`/geom/${old}.geojson`, `/geom/${next}.geojson`);
    return url;
  };
  const members: Binding["members"] = [];
  const memberIds = new Set<string>();
  for (const m of binding.members) {
    const id = swap(m.id);
    if (memberIds.has(id)) continue; // the successor was already a member
    memberIds.add(id);
    members.push(id === m.id ? { ...m } : { ...m, id });
  }
  const draft: Binding = {
    ...structuredClone(binding),
    binding_version: binding.binding_version + 1,
    anchor: swap(binding.anchor),
    stream_id: binding.stream_id === null ? null : swap(binding.stream_id),
    members,
    watersheds: [...new Set(binding.watersheds.map(swap))],
    boundary: { geometry_urls: [...new Set(binding.boundary.geometry_urls.map(swapUrl))] },
    needs: binding.needs.map((n) => ({ ...n, places: [...new Set(n.places.map(swap))] })),
    frozen_at: isoSeconds(options.now ?? new Date()),
    reviewed_by: null,
    twin_index_etag: null,
  };
  return { draft, findings };
}
