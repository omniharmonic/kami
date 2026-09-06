import { z } from "zod";
import { seriesFor } from "../entity.js";
import { summarizeSeries, windowSeries } from "../readings.js";
import * as twin from "../twin.js";
import { defineTool, ToolError } from "./registry.js";

export const get_reading_history = defineTool({
  name: "get_reading_history",
  description: "Summary of one property's series at a place over 24h or 7d (min, max, last, trend, n) from the place page's 7-day series, plus points_url. Raw points never go to the model.",
  inputSchema: {
    place_id: z.string().regex(/^[a-z_]+\/[a-z0-9-]+$/),
    property: z.string().min(1).max(64),
    window: z.enum(["24h", "7d"]).optional().describe("default 7d"),
  },
  async handler(input, ctx) {
    const id = input["place_id"] as string;
    const property = input["property"] as string;
    const window = (input["window"] as "24h" | "7d" | undefined) ?? "7d";
    const page = await twin.placePage(ctx.reader, id);
    if (!page) throw new ToolError(`latest/${id}.json is not published`, "not_found");
    let entries = Object.entries(page.series ?? {}).filter(([, s]) => s.property === property);
    const derived = entries.length ? null : seriesFor(page, property);
    if (derived) entries = [["derived:reservoir_fill", derived]];
    const base = twin.publicBase(ctx.reader);
    const points_url = `${base}/latest/${id}.json`;
    if (!entries.length) return { payload: { place_id: id, property, window, available: false, reason: `no ${property} series on the place page`, series_keys: Object.keys(page.series ?? {}), points_url }, source_path: `latest/${id}.json` };
    const [key, s] = entries[0]!;
    const lastT = s.t.length ? Date.parse(s.t[s.t.length - 1]!) : ctx.now();
    const windowed = window === "24h" ? windowSeries(s, lastT, 24 * 3600) : s;
    const summary = summarizeSeries(windowed);
    return {
      payload: { place_id: id, property, window, series_key: key, other_series_keys: entries.slice(1).map(([k]) => k), summary, points_url, page_generated_at: page.generated_at, note: "the window ends at the series' last point, not at now; the page's generated_at is not a clock" },
      source_path: `latest/${id}.json`,
    };
  },
});
