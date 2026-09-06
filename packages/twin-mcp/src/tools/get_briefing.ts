import { z } from "zod";
import { truncate } from "../entity.js";
import * as twin from "../twin.js";
import { defineTool } from "./registry.js";

export const get_briefing = defineTool({
  name: "get_briefing",
  description: "The twin's weekly briefing (fact sheet + guarded analysis) when the twin publishes one; {available:false} until briefings/ ships.",
  inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
  async handler(input, ctx) {
    const date = input["date"] as string | undefined;
    const path = date ? `briefings/${date}.json` : "briefings/latest.json";
    const b = await ctx.reader.getJson<Record<string, unknown>>(path);
    if (!b) return { payload: { available: false, reason: "twin publishes no briefings yet", path }, source_path: "latest/conditions.json" };
    const sections = Array.isArray(b["sections"]) ? (b["sections"] as unknown[]).slice(0, 8).map((s) => (typeof s === "string" ? truncate(s, 1200) : s)) : null;
    void twin;
    return {
      payload: { available: true, path, title: b["title"] ?? null, summary: truncate((b["summary"] as string) ?? null, 1500), sections, watch: b["watch"] ?? null, facts_url: date ? `briefings/${date}/facts.json` : null, generated_at: b["generated_at"] ?? null, honesty: "analysis written by an AI from the week's measured readings; every number links to its station" },
      source_path: path,
    };
  },
});
