import { z } from "zod";
import { byteLength, paginateFit } from "../envelope.js";
import { pointWithin } from "../geo.js";
import { normalizeReading, SourceStatusIndex } from "../readings.js";
import * as twin from "../twin.js";
import { defineTool, ToolError } from "./registry.js";

export const get_conditions = defineTool({
  name: "get_conditions",
  description:
    "Latest readings for monitoring sites from latest/conditions.json, filtered by place_ids, a HUC prefix, or `within` a place polygon (point-in-polygon computed server-side; properties only are returned). Paginated and size-capped.",
  inputSchema: {
    place_ids: z.array(z.string()).max(50).optional(),
    huc: z.string().regex(/^\d{2,12}$/).optional(),
    within: z.string().regex(/^[a-z_]+\/[a-z0-9-]+$/).optional().describe("a watershed/bioregion id whose geom/ polygon bounds the stations"),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async handler(input, ctx) {
    const c = await twin.requireConditions(ctx.reader);
    const ids = input["place_ids"] as string[] | undefined;
    const huc = input["huc"] as string | undefined;
    const within = input["within"] as string | undefined;
    let stations = c.stations;
    if (ids) {
      const set = new Set(ids);
      stations = stations.filter((s) => set.has(s.id));
    }
    if (huc) stations = stations.filter((s) => twin.matchesHuc(s, huc));
    if (within) {
      const poly = await twin.geometryOf(ctx.reader, within);
      if (!poly) throw new ToolError(`no geometry published for ${within}`, "not_found");
      stations = stations.filter((s) => typeof s.lon === "number" && typeof s.lat === "number" && pointWithin(s.lon, s.lat, poly));
    }
    const now = ctx.now();
    const sources = new SourceStatusIndex(c, await twin.health(ctx.reader));
    const rows = stations.map((s) => ({ id: s.id, name: s.name, huc12: s.huc12 ?? null, kind: s.kind, readings: s.readings.map((r) => normalizeReading(r, now, sources)) }));
    const page = paginateFit(rows, input["cursor"] as string | undefined, (input["limit"] as number | undefined) ?? 10, (p) => byteLength(p) + 1024);
    const used = new Set(page.items.flatMap((s) => s.readings.map((r) => r.source_id)));
    const src: Record<string, { health: string; staleness_s: number | null; last_ok: string | null }> = {};
    for (const id of [...used].sort()) {
      const h = c.sources[id];
      src[id] = { health: h?.health ?? sources.status(id), staleness_s: h?.staleness_s ?? null, last_ok: h?.last_ok ?? null };
    }
    return { payload: { stations: page.items, total: page.total, next_cursor: page.next_cursor ?? null, sources: src }, source_path: "latest/conditions.json" };
  },
});
