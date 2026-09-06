import { z } from "zod";
import { bboxOf, centroidOf } from "../geo.js";
import * as twin from "../twin.js";
import { defineTool, ToolError } from "./registry.js";

export const get_boundary_summary = defineTool({
  name: "get_boundary_summary",
  description: "The bioregion boundary as a proposal with its reasoning: id, boundary_version, ring, area_sqkm, huc8[], method, the first 600 characters of the rationale (CC BY-SA 4.0), rationale_url and geometry_url. No ring is returned.",
  inputSchema: { version: z.string().regex(/^v\d+$/).optional().describe("default v1") },
  async handler(input, ctx) {
    const v = (input["version"] as string | undefined) ?? "v1";
    const [f, md] = await Promise.all([twin.boundary(ctx.reader, v), twin.boundaryText(ctx.reader, v)]);
    if (!f) throw new ToolError(`boundary/${v}.geojson is not published`, "not_found");
    const p = f.properties;
    const base = twin.publicBase(ctx.reader);
    const prose = md ? md.replace(/\r/g, "").trim() : null;
    return {
      payload: {
        id: p["id"] ?? null,
        name: p["name"] ?? null,
        boundary_version: p["boundary_version"] ?? v,
        ring: p["ring"] ?? null,
        area_sqkm: p["area_sqkm"] ?? null,
        huc8: p["huc8"] ?? [],
        method: p["method"] ?? null,
        rationale: prose ? prose.slice(0, 600) + (prose.length > 600 ? "…" : "") : null,
        rationale_url: p["rationale_url"] ?? `${base}/boundary/${v}.md`,
        rationale_license: "CC BY-SA 4.0",
        geometry_url: `${base}/boundary/${v}.geojson`,
        bbox: bboxOf(f.geometry),
        centroid: centroidOf(f.geometry),
        note: "A boundary is a proposal, not a fact; read the rationale before treating the line as settled.",
      },
      source_path: `boundary/${v}.geojson`,
    };
  },
});
