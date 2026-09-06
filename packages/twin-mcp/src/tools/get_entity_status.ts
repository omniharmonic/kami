import { z } from "zod";
import { entityStatus } from "../entity.js";
import { bindingFor, defineTool } from "./registry.js";

export const get_entity_status = defineTool({
  name: "get_entity_status",
  description:
    "THE pulse call: for the entity's binding, each need resolved with its aggregation (value, unit, time, stale, staleness_s, source_status, 7-day week{min,max,trend}, label, percentile_por: null until the twin publishes baselines), the live picture over its watersheds (drought_max_dm, alerts, fires_inside, detections_24h), source health, snapshot_hash (sha256 over members' readings excluding generated_at/staleness_s) and a facts-1.0 block for the guard.",
  inputSchema: { entity: z.string().optional().describe("entity slug or entity/<slug>; optional when one binding is configured") },
  async handler(input, ctx) {
    const b = bindingFor(ctx, input["entity"] as string | undefined);
    const status = await entityStatus(ctx, b);
    return { payload: status as unknown as Record<string, unknown>, source_path: "latest/conditions.json" };
  },
});
