import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bandFor, EXPLANATIONS, EXPLANATIONS_ATTRIBUTION, explain, explainRaw, glossaryKeys, SOIL_DEPTH } from "../src/explanations.js";
import { runTool } from "../src/server.js";
import { FIXTURE_STALE, makeCtx, PKG } from "./helpers.js";

describe("explanations (vendored, CC BY-SA 4.0)", () => {
  it("carries the licence and attribution on every explain() result", () => {
    const e = explain("discharge");
    expect(e.license).toBe("CC BY-SA 4.0");
    expect(e.attribution).toBe(EXPLANATIONS_ATTRIBUTION);
    expect(e.label).toBe("Discharge");
    expect(e.unitHelp).toContain("cubic feet per second");
    expect(e.known).toBe(true);
  });

  it("has all six class:* keys and the water/snow/air/weather/soil families", () => {
    for (const k of ["class:station", "class:fire", "class:detection", "class:alert", "class:quake", "class:drought"]) expect(EXPLANATIONS[k]).toBeDefined();
    expect(glossaryKeys()[0]).toBe("discharge");
    expect(glossaryKeys().length).toBe(44);
  });

  it("bands only where a settled scale exists; Infinity is null on the wire", () => {
    expect(bandFor("pm25", 40)?.name).toBe("Unhealthy for sensitive groups");
    expect(bandFor("pm25", 9)?.name).toBe("Good");
    expect(bandFor("ozone", 71)?.name).toBe("Unhealthy for sensitive groups");
    expect(bandFor("class:drought", 1)?.name).toBe("D1 · Moderate drought");
    expect(bandFor("discharge", 100)).toBeNull();
    const last = explain("pm25").bands!.at(-1)!;
    expect(last.upTo).toBeNull();
    expect(last.name).toBe("Hazardous");
  });

  it("resolves depth-suffixed soil keys and never throws on unknown keys", () => {
    expect(SOIL_DEPTH.test("soil_moisture_8in")).toBe(true);
    expect(explainRaw("soil_moisture_8in").label).toBe("Soil moisture at 8 in");
    expect(explainRaw("soil_temp_5cm").label).toBe("Soil temperature at 5 cm");
    const u = explain("mystery_gauge_thing");
    expect(u.known).toBe(false);
    expect(u.label).toBe("mystery gauge thing");
    expect(u.short).toBe("A reading this site has no plain-language note for yet.");
  });

  it("labels flow_forecast as a forecast", () => {
    expect(explainRaw("flow_forecast").label.toLowerCase()).toContain("forecast");
  });

  it("every property in the fixture tree resolves to a real explanation (the twin's own contract test)", () => {
    const c = JSON.parse(readFileSync(join(FIXTURE_STALE, "latest/conditions.json"), "utf8")) as { stations: { readings: { property: string }[] }[] };
    for (const s of c.stations) for (const r of s.readings) expect(explain(r.property).known, r.property).toBe(true);
  });

  it("the prose is byte-identical to the twin's table when the twin repo is present", () => {
    const twin = process.env["TWIN_REPO"] ?? "/home/user/frontrange-twin";
    let src: string;
    try {
      src = readFileSync(join(twin, "web/src/copy/explanations.ts"), "utf8");
    } catch {
      return; // twin repo not checked out here
    }
    const ours = readFileSync(join(PKG, "src/explanations.ts"), "utf8");
    const table = (t: string) => t.slice(t.indexOf("export const EXPLANATIONS:"), t.indexOf("\n};", t.indexOf("export const EXPLANATIONS:")) + 3);
    expect(table(ours)).toBe(table(src));
  });

  it("the explain tool returns the band for a value", async () => {
    const out = await runTool(await makeCtx(), "explain", { property: "pm25", value: 60 });
    expect((out["band"] as { name: string }).name).toBe("Unhealthy");
    expect(out["license"]).toBe("CC BY-SA 4.0");
  });
});
