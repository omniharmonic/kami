import { z } from "zod";
import * as twin from "../twin.js";
import { defineTool, ToolError } from "./registry.js";

export const compare_to_normal = defineTool({
  name: "compare_to_normal",
  description: "Where today's reading sits against the site's record. Blocked until the twin publishes baselines: returns {available:false, reason:\"twin publishes no baseline yet\", record_start?}. When a reading carries a `context` block or normals/<id>.json exists, returns {percentile_por, median_por, years_of_record, label, provisional}.",
  inputSchema: {
    place_id: z.string().regex(/^[a-z_]+\/[a-z0-9-]+$/),
    property: z.string().min(1).max(64),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  },
  async handler(input, ctx) {
    const id = input["place_id"] as string;
    const property = input["property"] as string;
    const page = await twin.placePage(ctx.reader, id);
    if (!page) throw new ToolError(`latest/${id}.json is not published`, "not_found");
    const reading = page.readings.find((r) => r.property === property);
    const record_start = (page.props?.["cdwr_por_start"] as string | undefined) ?? null;
    const ctxBlock = reading?.context as Record<string, unknown> | undefined;
    const normals = await ctx.reader.getJson<Record<string, unknown>>(`normals/${id}.json`);
    if (!ctxBlock && !normals) {
      return { payload: { place_id: id, property, available: false, reason: "twin publishes no baseline yet", record_start }, source_path: `latest/${id}.json` };
    }
    const date = (input["date"] as string | undefined) ?? new Date(ctx.now()).toISOString().slice(0, 10);
    const doy = date.slice(5);
    const byDoy = (normals?.["by_doy"] as Record<string, Record<string, unknown>> | undefined)?.[doy];
    const basis = normals?.["basis"] as Record<string, unknown> | undefined;
    return {
      payload: {
        place_id: id,
        property,
        available: true,
        date,
        percentile_por: (ctxBlock?.["percentile"] as number | undefined) ?? null,
        class: (ctxBlock?.["class"] as string | undefined) ?? null,
        median_por: (byDoy?.["median"] as number | undefined) ?? null,
        years_of_record: (ctxBlock?.["years_of_record"] as number | undefined) ?? (basis?.["years_of_record"] as number | undefined) ?? null,
        label: (ctxBlock?.["sentence"] as string | undefined) ?? null,
        provisional: (ctxBlock?.["provisional"] as boolean | undefined) ?? null,
        basis_kind: (ctxBlock?.["basis_kind"] as string | undefined) ?? (basis?.["kind"] as string | undefined) ?? null,
        record_start: (basis?.["record_begin"] as string | undefined) ?? record_start,
      },
      source_path: `latest/${id}.json`,
    };
  },
});
