import { readingStaleness } from "../staleness.js";
import * as twin from "../twin.js";
import { defineTool, ToolError } from "./registry.js";

export const get_snow = defineTool({
  name: "get_snow",
  description: "The snowline artifact (latest/snow.json): snowline_m (null when fewer than 3 usable sites, none report snow, or all are stale), opacity, the SNOTEL basis with per-site stale flags, and the rule verbatim.",
  inputSchema: {},
  async handler(_input, ctx) {
    const s = await twin.snow(ctx.reader);
    if (!s) throw new ToolError("latest/snow.json is not published", "not_found");
    const sources = await twin.sourceIndex(ctx.reader);
    const now = ctx.now();
    const basis = s.basis.map((b) => {
      const st = readingStaleness({ time: b.time ?? null, stale: b.stale }, now);
      return { ...b, source_id: "nrcs.awdb", staleness_s: st.seconds === null ? null : Math.round(st.seconds), source_status: sources.status("nrcs.awdb") };
    });
    return { payload: { snowline_m: s.snowline_m, opacity: s.opacity, basis, rule: s.rule, stale: s.stale, units: { swe_mm: "mm", snow_depth_cm: "cm", elevation_m: "m" } }, source_path: "latest/snow.json" };
  },
});
