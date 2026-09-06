import { z } from "zod";
import { paginate } from "../envelope.js";
import { bboxesOverlap, type BBox } from "../geo.js";
import * as twin from "../twin.js";
import { defineTool } from "./registry.js";

export const find_places = defineTool({
  name: "find_places",
  description:
    "Search the twin's identity registry (id/index.json) by name substring, kind, HUC prefix or bbox. Returns ids to pass to get_place. Paginated (limit ≤ 50).",
  inputSchema: {
    query: z.string().min(1).max(120).optional().describe("case-insensitive substring of the name or id"),
    kind: z.string().optional().describe("place kind, e.g. monitoring_site | watershed | bioregion"),
    huc: z.string().regex(/^\d{2,12}$/).optional().describe("HUC prefix (2–12 digits)"),
    bbox: z.array(z.number()).length(4).optional().describe("[minLon, minLat, maxLon, maxLat]"),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async handler(input, ctx) {
    const idx = await twin.requireIndex(ctx.reader);
    const q = (input["query"] as string | undefined)?.toLowerCase();
    const kind = input["kind"] as string | undefined;
    const huc = input["huc"] as string | undefined;
    const bbox = input["bbox"] as BBox | undefined;
    const hits = idx.places.filter((p) => {
      if (q && !(p.name.toLowerCase().includes(q) || p.id.includes(q))) return false;
      if (kind && p.kind !== kind) return false;
      if (huc && !twin.matchesHuc(p, huc)) return false;
      if (bbox && !bboxesOverlap(bbox, (p.bbox as BBox | undefined) ?? null)) return false;
      return true;
    });
    const page = paginate(hits, input["cursor"] as string | undefined, input["limit"] as number | undefined);
    return {
      payload: { places: page.items.map((p) => ({ id: p.id, kind: p.kind, name: p.name, huc12: p.huc12 ?? null, bbox: p.bbox ?? null })), total: page.total, next_cursor: page.next_cursor ?? null, index_count: idx.count },
      source_path: "id/index.json",
    };
  },
});
