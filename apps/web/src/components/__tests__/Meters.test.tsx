// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

afterEach(cleanup);
import { Meters } from "../Meters";
import fixture from "@/fixtures/status/boulder-creek.json";
import type { HealthSnapshot } from "@kami/needs";

const snapshot = fixture.snapshot as HealthSnapshot;

describe("Meters", () => {
  it("renders one ring per need with value, unit, time and source as text", () => {
    const { container } = render(<Meters snapshot={snapshot} />);
    const items = container.querySelectorAll("li.meter");
    expect(items).toHaveLength(6);
    const storage = container.querySelector("li[data-need='storage']")!;
    expect(storage.textContent).toContain("72 %");
    expect(storage.textContent).toContain("2026-09-06T05:00:00Z");
    expect(storage.textContent).toContain("cdss.telemetry");
  });

  it("labels a stale need \"can't feel it\" with a grey ring and keeps its last reading visible", () => {
    const { container } = render(<Meters snapshot={snapshot} />);
    const flow = container.querySelector("li[data-need='flow']")!;
    expect(flow.getAttribute("data-stale")).toBe("true");
    expect(within(flow as HTMLElement).getByText("can't feel it")).toBeTruthy();
    expect(flow.querySelector("svg")!.getAttribute("class")).toContain("ring-stale");
    expect(flow.textContent).toContain("15.4 [ft_i]3/s");
    expect(flow.textContent).toContain("2026-09-04T20:15:00Z");
    expect(flow.textContent).toMatch(/stale for/);
    expect(flow.querySelector("svg")!.getAttribute("aria-label")).toContain("can't feel it");
  });

  it("marks an unbanded need as value-and-trend only", () => {
    const { container } = render(<Meters snapshot={snapshot} />);
    const water = container.querySelector("li[data-need='water']")!;
    expect(water.textContent).toContain("no published band");
    expect(water.querySelector("svg")!.getAttribute("class")).toContain("ring-unbanded");
  });

  it("says it cannot reach its senses when there is no snapshot", () => {
    render(<Meters snapshot={null} />);
    expect(screen.getByText(/can't reach my senses/)).toBeTruthy();
  });
});
