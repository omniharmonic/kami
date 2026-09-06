import { z } from "zod";
import { alertsFor } from "../entity.js";
import { bindingFor, defineTool } from "./registry.js";

export const get_alerts = defineTool({
  name: "get_alerts",
  description: "Everything alert-shaped touching the entity: NWS alerts (polygon-matched to its watersheds, or zone-only with matched_by: null), the Drought Monitor class when ≥ D1, active fires inside, and PM2.5 beyond Moderate at its air member.",
  inputSchema: { entity: z.string().optional() },
  async handler(input, ctx) {
    const b = bindingFor(ctx, input["entity"] as string | undefined);
    const alerts = await alertsFor(ctx, b);
    return { payload: { entity_id: b.entity_id, alerts, total: alerts.length }, source_path: "latest/alerts.geojson" };
  },
});
