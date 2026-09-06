import { z } from "zod";
import { truncate } from "../entity.js";
import { byteLength, paginateFit } from "../envelope.js";
import { bboxOf, centroidOf, geometriesIntersectApprox, pointInPolygon } from "../geo.js";
import * as twin from "../twin.js";
import type { Feature, Geometry, LiveLayer } from "../types.js";
import { defineTool, ToolError } from "./registry.js";

const LONG_TEXT = new Set(["description", "instruction"]);

export function liveFeatureOut(f: Feature, matched_by: "within" | "all" | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f.properties)) {
    if (k === "geometry" || k === "coordinates" || k === "point") continue;
    out[k] = LONG_TEXT.has(k) && typeof v === "string" ? truncate(v, 400) : v;
  }
  const g = f.geometry;
  if (!g) {
    out["geometry"] = null;
    out["matched_by"] = null;
    out["centroid"] = null;
  } else {
    out["geometry_type"] = g.type;
    out["centroid"] = centroidOf(g);
    out["bbox"] = bboxOf(g);
    out["matched_by"] = matched_by;
  }
  return out;
}

export const get_live = defineTool({
  name: "get_live",
  description:
    "Features of a live layer (alerts | drought | fires | detections | quakes), optionally only those intersecting the polygon of `within`. Properties plus centroid/bbox only — never a ring. Zone-only NWS alerts have no polygon and are returned with geometry: null, matched_by: null. Drought features carry dm, label, period_start, period_end.",
  inputSchema: {
    layer: z.enum(["alerts", "drought", "fires", "detections", "quakes"]),
    within: z.string().regex(/^[a-z_]+\/[a-z0-9-]+$/).optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async handler(input, ctx) {
    const layer = input["layer"] as LiveLayer;
    const fc = await twin.layer(ctx.reader, layer);
    if (!fc) throw new ToolError(`latest/${layer}.geojson is not published`, "not_found");
    const within = input["within"] as string | undefined;
    let poly: Geometry | null = null;
    if (within) {
      poly = await twin.geometryOf(ctx.reader, within);
      if (!poly) throw new ToolError(`no geometry published for ${within}`, "not_found");
    }
    const rows: Record<string, unknown>[] = [];
    for (const f of fc.features) {
      if (!poly) {
        rows.push(liveFeatureOut(f, "all"));
        continue;
      }
      const g = f.geometry;
      if (!g) {
        rows.push(liveFeatureOut(f, null));
        continue;
      }
      const hit = g.type === "Point" ? pointInPolygon(g.coordinates[0]!, g.coordinates[1]!, poly) : geometriesIntersectApprox(g, poly);
      if (hit) rows.push(liveFeatureOut(f, "within"));
    }
    const page = paginateFit(rows, input["cursor"] as string | undefined, input["limit"] as number | undefined, (p) => byteLength(p) + 512);
    const unplaced = rows.filter((r) => r["geometry"] === null).length;
    return {
      payload: { layer, source_id: fc.source_id ?? twin.LIVE_SOURCE[layer], within: within ?? null, features: page.items, total: page.total, unplaced, next_cursor: page.next_cursor ?? null },
      source_path: `latest/${layer}.geojson`,
    };
  },
});
