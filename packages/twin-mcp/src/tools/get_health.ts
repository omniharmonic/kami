import * as twin from "../twin.js";
import { defineTool, ToolError } from "./registry.js";

export const get_health = defineTool({
  name: "get_health",
  description: "The honesty board (latest/health.json): per source, is the feed up (health, last_ok, staleness_s) and are its values fresh (readings, stale_readings), with the thresholds that decide.",
  inputSchema: {},
  async handler(_input, ctx) {
    const h = await twin.health(ctx.reader);
    if (!h) throw new ToolError("latest/health.json is not published", "not_found");
    const sources = h.sources.map((s) => ({
      source_id: s.source_id,
      title: s.title,
      agency: s.agency,
      tier: s.tier,
      license: s.license,
      health: s.health,
      last_ok: s.last_ok ?? null,
      last_error: s.last_error ?? null,
      staleness_s: s.staleness_s ?? null,
      nominal_cadence_s: s.nominal_cadence_s,
      staleness_warn_s: s.staleness_warn_s,
      staleness_crit_s: s.staleness_crit_s,
      readings: s.readings,
      stale_readings: s.stale_readings,
    }));
    const tally = { ok: 0, warning: 0, critical: 0, unknown: 0 };
    for (const s of sources) tally[s.health]++;
    return { payload: { sources, tally }, source_path: "latest/health.json" };
  },
});
