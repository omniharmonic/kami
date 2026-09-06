import { describe, expect, it } from "vitest";
import { loadStatus, parseStatus, defaultDataDir, hoursBehind, listLocalStatusSlugs } from "../status";

describe("loadStatus", () => {
  it("reads the Boulder Creek fixture from the default data dir", async () => {
    const s = await loadStatus("boulder-creek", { dataDir: defaultDataDir() });
    expect(s).not.toBeNull();
    expect(s!.snapshot.mood).toBe("asleep");
    expect(s!.snapshot.mood_reason).toBe("I can't feel my gauge");
    expect(s!.snapshot.stale_driving).toBe(true);
    expect(s!.snapshot.needs).toHaveLength(6);
    const flow = s!.snapshot.needs.find((n) => n.need === "flow")!;
    expect(flow.stale).toBe(true);
    expect(flow.value).toBe(15.4);
    expect(flow.time).toBe("2026-09-04T20:15:00Z");
    expect(s!.snapshot.alert_level).toBe(0);
    expect(s!.snapshot.season).toBe(2);
    expect(s!.as_of).toBe("2026-09-06T06:00:00Z");
  });
  it("returns null for an unknown slug or a bad slug", async () => {
    expect(await loadStatus("nope", { dataDir: defaultDataDir() })).toBeNull();
    expect(await loadStatus("../etc/passwd", { dataDir: defaultDataDir() })).toBeNull();
  });
  it("returns null for malformed JSON rather than throwing", () => {
    expect(parseStatus("{not json")).toBeNull();
    expect(parseStatus(JSON.stringify({ entity_id: "x" }))).toBeNull();
  });
  it("lists local slugs", async () => {
    expect(await listLocalStatusSlugs(defaultDataDir())).toContain("boulder-creek");
  });
  it("computes hours behind", () => {
    expect(hoursBehind("2026-09-06T00:00:00Z", new Date("2026-09-06T03:30:00Z"))).toBe(4);
    expect(hoursBehind("garbage")).toBe(0);
  });
});
