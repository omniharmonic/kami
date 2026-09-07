import { describe, expect, it, vi } from "vitest";
import type { BindingNeed } from "@kami/binding";
import { resolveNeedInput, TreeReader } from "../readings";
import { NOW, twinFromFixtures } from "./helpers";

const need: BindingNeed = { need: "flow", property: "discharge", places: ["place/boulder-creek-near-orodell-co"], agg: "mean_24h" };

describe("reviewed temporal aggregation", () => {
  it("keeps the instantaneous observation available but does not present it as a daily mean without a series", async () => {
    const reader = new TreeReader(twinFromFixtures(), NOW.getTime());
    const page = await reader.page(need.places[0]!);
    expect(page).not.toBeNull();
    vi.spyOn(reader, "page").mockResolvedValue({ ...page!, series: {} });
    expect(await resolveNeedInput(reader, need, [])).toBeNull();
    expect(await resolveNeedInput(reader, { ...need, agg: "single" }, [])).toMatchObject({ value: 15.4, source_id: "cdss.telemetry" });
  });

  it("requires usable samples in the requested day, excluding old and future points", async () => {
    const reader = new TreeReader(twinFromFixtures(), NOW.getTime());
    const page = await reader.page(need.places[0]!);
    vi.spyOn(reader, "page").mockResolvedValue({ ...page!, series: { discharge: { property: "discharge", unit: "[ft_i]3/s", source_id: "cdss.telemetry", t: ["2020-01-01T00:00:00Z", "2099-01-01T00:00:00Z"], v: [100, 200] } } });
    expect(await resolveNeedInput(reader, need, [])).toBeNull();
  });

  it("computes the mean from published samples instead of the latest instantaneous value", async () => {
    const reader = new TreeReader(twinFromFixtures(), NOW.getTime());
    const page = await reader.page(need.places[0]!);
    vi.spyOn(reader, "page").mockResolvedValue({ ...page!, series: { discharge: { property: "discharge", unit: "[ft_i]3/s", source_id: "cdss.telemetry", t: ["2026-09-04T08:15:00Z", "2026-09-04T20:15:00Z"], v: [10, 20] } } });
    expect(await resolveNeedInput(reader, need, [])).toMatchObject({ value: 15, time: "2026-09-04T20:15:00Z", stale: true, source_id: "cdss.telemetry" });
  });
});
