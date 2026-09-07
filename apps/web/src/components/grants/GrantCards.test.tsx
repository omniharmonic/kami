// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GrantCards } from "./GrantCards";
afterEach(cleanup);
describe("grant cards", () => {
  it("shows budget as planning and links to the actual round with a machine-readable deadline", () => {
    render(<GrantCards slug="creek" rounds={[{ id: "round_1", title: "Riparian ideas", description: "Local shade projects", status: "draft", budget: "100", applications: 0, closesAt: "2026-10-01T12:00:00Z" }]} />);
    expect(screen.getByRole("link", { name: "Riparian ideas" }).getAttribute("href")).toBe("/e/creek/grants#round_1");
    expect(screen.getByText("Planning budget")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(document.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-01T12:00:00Z");
  });
  it("describes an empty round list without inventing an award", () => {
    render(<GrantCards slug="creek" rounds={[]} />);
    expect(screen.getByText(/No grant rounds yet/)).toBeTruthy();
    expect(screen.queryByText(/USDC/)).toBeNull();
  });
});
