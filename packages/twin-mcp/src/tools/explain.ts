import { z } from "zod";
import { bandFor, explain as explainKey, glossaryKeys } from "../explanations.js";
import { defineTool } from "./registry.js";

export const explain = defineTool({
  name: "explain",
  description: "Plain-language explanation of a property (discharge, swe, pm25, …) or a class:<kind> key, with unit help and, where a settled scale exists, bands. Static copy vendored from the twin, CC BY-SA 4.0 with attribution. Never a model output. Pass `value` to get the band it falls in.",
  inputSchema: { property: z.string().min(1).max(64), value: z.number().optional() },
  async handler(input) {
    const key = input["property"] as string;
    const e = explainKey(key);
    const value = input["value"] as number | undefined;
    const band = value === undefined ? null : bandFor(key, value);
    return { payload: { ...e, band: band ? { name: band.name, note: band.note } : null, glossary_size: glossaryKeys().length } };
  },
});
