// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Avatar } from "../Avatar";
import fixture from "@/fixtures/status/boulder-creek.json";
import type { HealthSnapshot } from "@kami/needs";
import * as loader from "../avatar/load-runtime";

afterEach(cleanup);

const snapshot = fixture.snapshot as HealthSnapshot;

describe("Avatar (no rig available — today's production path)", () => {
  it("renders the asleep SVG with an aria-label carrying \"can't feel my gauge\" and the headline", () => {
    const { container } = render(<Avatar snapshot={snapshot} archetype="creek" name="Boulder Creek" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("/rigs/fallback/creek-asleep.svg");
    const label = img.getAttribute("aria-label")!;
    // alt matches aria-label exactly, so the image is never nameless if ARIA is stripped.
    expect(img.getAttribute("alt")).toBe(label);
    expect(label).toContain("can't feel my gauge");
    expect(label).toContain("Flow: 15.4 cfs at Orodell, 2026-09-04 20:15Z, stale");
    expect(container.querySelector(".avatar-stage")!.getAttribute("data-avatar-reason")).toBe("rig-unavailable");
    expect(container.querySelector(".avatar-stage")!.getAttribute("data-avatar-mode")).toBe("svg");
    expect(container.querySelector("figure")!.getAttribute("data-stale")).toBe("true");
  });

  it("shows the mood word and mood_reason as visible text (never colour alone)", () => {
    render(<Avatar snapshot={snapshot} archetype="creek" name="Boulder Creek" />);
    expect(screen.getByTestId("mood-reason").textContent).toBe("I can't feel my gauge");
    expect(screen.getByTestId("mood-word").textContent).toBe("asleep");
    expect(screen.getByTestId("mood-word").className).toContain("chip-stale");
  });

  it("never attempts the runtime when the rig is unavailable", async () => {
    const spy = vi.spyOn(loader, "loadRiveRuntime");
    render(<Avatar snapshot={snapshot} archetype="creek" name="Boulder Creek" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("renders a content mountain when the snapshot says so, and asleep when there is no snapshot", () => {
    const content: HealthSnapshot = { ...snapshot, mood: "content", mood_reason: "all my readings are in band", stale_driving: false };
    const { unmount } = render(<Avatar snapshot={content} archetype="mountain" name="Niwot Ridge" />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/rigs/fallback/mountain-content.svg");
    expect(screen.getByTestId("mood-word").className).not.toContain("chip-stale");
    unmount();
    render(<Avatar snapshot={null} archetype="reservoir" name="Gross Reservoir" />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/rigs/fallback/reservoir-asleep.svg");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Gross Reservoir");
  });

  it("falls back to the creek SVG for an unknown archetype rather than a broken image", () => {
    render(<Avatar snapshot={snapshot} archetype="glacier" name="X" />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/rigs/fallback/creek-asleep.svg");
  });
});
