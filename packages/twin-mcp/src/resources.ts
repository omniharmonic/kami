/** Static resources (`ttlMs` 300 000): the boundary summary, the glossary, the licence, about. */

import { EXPLANATIONS_ATTRIBUTION, explainRaw, glossaryKeys } from "./explanations.js";
import type { ToolContext } from "./context.js";
import * as twin from "./twin.js";
import { DEFAULT_TREE, PACKAGE_VERSION } from "./tree.js";

export const RESOURCE_TTL_MS = 300_000;

export interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: (ctx: ToolContext) => Promise<string>;
}

export const LICENCE_TEXT = `Front Range Bioregional Twin — licences

Code (this package, the publisher): Apache-2.0.
Structured facts (readings, ids, geometries as published): CC0 1.0.
Prose (the explanations table, boundary rationale, briefings): CC BY-SA 4.0 —
attribute "Front Range Bioregional Twin (bioregionaltwin.org)" and share alike.
Per-source licences are on the honesty board (get_health → license); a source
marked cc-by-nc (PurpleAir) is never blended into a CC0 aggregate.
Upstream agencies (USGS, CDSS/DWR, NOAA/NWS, NRCS, EPA, NASA, NIFC, NDMC) retain
their own terms; their attribution strings ride on every reading's source.`;

export function aboutText(ctx: ToolContext): string {
  return `bioregionaltwin-mcp ${PACKAGE_VERSION} — a read-only MCP server over the Front Range Bioregional Twin's published tree.

Tree: ${ctx.reader.isRemote ? ctx.reader.base : `${ctx.reader.base} (local directory)`} (default ${DEFAULT_TREE}).
Mode: ${ctx.mode}. Bindings: ${[...ctx.bindings.keys()].join(", ") || "none"}.

It is a pure function of static files: no database, no origin server, no write path. It reads the tree as a browser does (GET, If-None-Match, 60 s floor on latest/, User-Agent with a contact).

Rules it enforces: every reading carries time, unit (UCUM), source_id, stale, staleness_s, source_status; absent means unknown, never zero; flow_forecast is labelled a forecast; no geometry ever enters a tool output (URLs, centroids, bboxes at most); every output ≤ 16 KB; lists paginate with cursor + limit ≤ 50.

Staleness has two dialects in the tree — a precomputed verdict on latest/conditions.json and snow.json, a threshold (staleness_crit_s) on per-place pages — and this server resolves both threshold-then-flag; a reading with neither is unknown, not fresh. A 404 is meaningful: superseded, withdrawn, or not yet published.`;
}

export function glossaryText(): string {
  return glossaryKeys()
    .map((k) => {
      const e = explainRaw(k);
      return `## ${k} — ${e.label}\n${e.short}\n${e.long}${e.unitHelp ? `\nUnit: ${e.unitHelp}` : ""}${e.scale ? `\nScale: ${e.scale} (${e.source})` : ""}`;
    })
    .join("\n\n")
    .concat(`\n\n— ${EXPLANATIONS_ATTRIBUTION}`);
}

export const RESOURCES: ResourceDef[] = [
  {
    uri: "twin://boundary/v1",
    name: "Front Range Bioregion boundary v1 (summary)",
    description: "Boundary properties and rationale prose; the ring itself is at geometry_url.",
    mimeType: "text/markdown",
    async read(ctx) {
      const [f, md] = await Promise.all([twin.boundary(ctx.reader, "v1"), twin.boundaryText(ctx.reader, "v1")]);
      if (!f) return "boundary/v1 is not published at this tree.";
      const p = f.properties;
      const head = `# ${p["name"] ?? "Boundary"} — ${p["boundary_version"] ?? "v1"}\n\narea_sqkm: ${p["area_sqkm"]}\nhuc8: ${(p["huc8"] as string[] | undefined)?.join(", ")}\nmethod: ${p["method"]}\ngeometry_url: ${twin.publicBase(ctx.reader)}/boundary/v1.geojson\nrationale_url: ${p["rationale_url"]}\n\n`;
      return head + (md ?? "").slice(0, 12_000);
    },
  },
  { uri: "twin://glossary", name: "Glossary of readings", description: "Every property the twin publishes, explained (CC BY-SA 4.0).", mimeType: "text/markdown", read: async () => glossaryText() },
  { uri: "twin://licence", name: "Licences", description: "Code Apache-2.0; facts CC0; prose CC BY-SA 4.0.", mimeType: "text/plain", read: async () => LICENCE_TEXT },
  { uri: "twin://about", name: "About this server", description: "What this server is, what it enforces, how it reads the tree.", mimeType: "text/plain", read: async (ctx) => aboutText(ctx) },
];
