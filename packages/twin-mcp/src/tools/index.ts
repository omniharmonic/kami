import { compare_to_normal } from "./compare_to_normal.js";
import { explain } from "./explain.js";
import { find_places } from "./find_places.js";
import { get_alerts } from "./get_alerts.js";
import { get_boundary_summary } from "./get_boundary_summary.js";
import { get_briefing } from "./get_briefing.js";
import { get_conditions } from "./get_conditions.js";
import { get_entity_status } from "./get_entity_status.js";
import { get_health } from "./get_health.js";
import { get_live } from "./get_live.js";
import { get_place } from "./get_place.js";
import { get_reading_history } from "./get_reading_history.js";
import { get_snow } from "./get_snow.js";
import { list_entities } from "./list_entities.js";
import { resolve_entity } from "./resolve_entity.js";
import type { ToolDef } from "./registry.js";

/** Architecture §4.2 order: primitives, then composites. */
export const TOOLS: ToolDef[] = [
  find_places,
  get_place,
  get_conditions,
  get_live,
  get_snow,
  get_health,
  get_boundary_summary,
  get_briefing,
  explain,
  list_entities,
  resolve_entity,
  get_entity_status,
  get_reading_history,
  get_alerts,
  compare_to_normal,
] as ToolDef[];

export * from "./registry.js";
