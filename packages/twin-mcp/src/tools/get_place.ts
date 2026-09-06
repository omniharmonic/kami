import { z } from "zod";
import { normalizeReading, safeProps, summarizeSeries } from "../readings.js";
import * as twin from "../twin.js";
import { defineTool, ToolError } from "./registry.js";

export const get_place = defineTool({
  name: "get_place",
  description:
    "One place: its identity record (id/<id>.json), its latest readings with stale/staleness_s computed from staleness_crit_s against the current clock, a 7-day series summary per datastream (min, max, last, trend, n) and points_url for the raw series. No series points and no geometry are returned; use geometry_url.",
  inputSchema: {
    id: z.string().regex(/^[a-z_]+\/[a-z0-9-]+$/).describe("twin id, e.g. place/boulder-creek-near-orodell-co"),
    series: z.boolean().optional().describe("include series_summary (default true)"),
  },
  async handler(input, ctx) {
    const id = input["id"] as string;
    const [rec, page, sources] = await Promise.all([twin.idRecord(ctx.reader, id), twin.placePage(ctx.reader, id), twin.sourceIndex(ctx.reader)]);
    if (!page && !rec) throw new ToolError(`${id} is not published (no id/ record and no latest/ page)`, "not_found");
    const now = ctx.now();
    const readings = (page?.readings ?? []).map((r) => normalizeReading(r, now, sources));
    const series_summary = input["series"] === false ? undefined : Object.fromEntries(Object.entries(page?.series ?? {}).map(([k, s]) => [k, summarizeSeries(s)]));
    const base = twin.publicBase(ctx.reader);
    const payload: Record<string, unknown> = {
      id,
      kind: rec?.kind ?? page?.kind ?? null,
      name: rec?.name ?? page?.name ?? null,
      huc12: rec?.huc12 ?? page?.huc12 ?? null,
      bbox: rec?.bbox ?? page?.bbox ?? null,
      centroid: page?.centroid ?? null,
      sensitivity: rec?.sensitivity ?? null,
      identity_published: !!rec,
      superseded_by: page?.superseded_by ?? null,
      parent_id: page?.parent_id ?? null,
      children: page?.children ?? [],
      geometry_url: rec?.geometry_url ?? `${base}/geom/${id}.geojson`,
      latest_url: rec?.latest_url ?? `${base}/latest/${id}.json`,
      twin_url: rec?.twin_url ?? null,
      commons_url: rec?.commons_url ?? null,
      sameAs: rec?.sameAs ?? [],
      props: safeProps(page?.props) ?? null,
      readings,
      series_summary: series_summary ?? null,
      points_url: rec?.latest_url ?? `${base}/latest/${id}.json`,
      page_generated_at: page?.generated_at ?? null,
      note: !rec && page ? "no identity record: this place is superseded or withdrawn; the page remains for old links" : undefined,
    };
    if (payload["note"] === undefined) delete payload["note"];
    return { payload, source_path: page ? `latest/${id}.json` : `id/${id}.json` };
  },
});
