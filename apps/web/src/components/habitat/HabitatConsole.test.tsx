// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HabitatConsole } from "./HabitatConsole";
import { habitatPhrase } from "@/copy/habitat";
import fixture from "@/fixtures/status/boulder-creek.json";
import type { HealthSnapshot } from "@kami/needs";
afterEach(cleanup);
describe("habitat console", () => {
  it("exposes the selected journal and supports keyboard navigation", () => {
    render(<HabitatConsole tabs={[{ id: "senses", label: "Senses", icon: "◉", content: <p>Measured readings</p> }, { id: "chat", label: "Chat", icon: "✧", content: <p>Conversation</p> }]} />);
    const senses = screen.getByRole("tab", { name: "Senses" });
    expect(senses.getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    fireEvent.keyDown(senses, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Chat" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Conversation");
  });
  it("does not describe paused or unknown signals as healthy", () => {
    expect(habitatPhrase(null, true)).toContain("paused");
    expect(habitatPhrase(null, false)).toContain("first field notes");
    expect(habitatPhrase({ ...fixture.snapshot, stale_driving: true } as HealthSnapshot, false)).toContain("fresh field note");
  });
});
