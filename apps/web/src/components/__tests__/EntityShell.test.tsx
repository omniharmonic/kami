// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

afterEach(cleanup);
import { EntityShell } from "../EntityShell";
import { DisclosureLabel } from "../DisclosureLabel";
import fixture from "@/fixtures/status/boulder-creek.json";
import type { HealthSnapshot } from "@kami/needs";

const snapshot = fixture.snapshot as HealthSnapshot;
const LABEL = "I'm an AI voice for Boulder Creek, built on public sensor data — not the creek, not a legal person.";

describe("EntityShell (ADR-E13 invariant)", () => {
  it("renders the disclosure label under the avatar and above the page content", () => {
    const { container } = render(
      <EntityShell entity={{ slug: "boulder-creek", name: "Boulder Creek", archetype: "creek", paused: false }} snapshot={snapshot} asOf={fixture.as_of}>
        <p data-testid="child">page content</p>
      </EntityShell>,
    );
    const label = screen.getByTestId("disclosure");
    expect(label.textContent).toBe(LABEL);
    const avatar = container.querySelector("img[role='img']")!;
    const child = screen.getByTestId("child");
    // document order: avatar → label → children
    expect(avatar.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders the label even with no snapshot (Neon and R2 unreachable)", () => {
    render(
      <EntityShell entity={{ slug: "x", name: "Boulder Creek", archetype: "creek", paused: true }} snapshot={null} asOf={null}>
        <span />
      </EntityShell>,
    );
    expect(screen.getByTestId("disclosure").textContent).toBe(LABEL);
    expect(screen.getByText(/paused by my guardians/)).toBeTruthy();
  });

  it("uses the archetype noun and the 'for' wording", () => {
    render(<DisclosureLabel name="Gross Reservoir" archetype="reservoir" />);
    const t = screen.getByTestId("disclosure").textContent!;
    expect(t).toContain("AI voice for Gross Reservoir");
    expect(t).toContain("not the reservoir");
    expect(t).not.toMatch(/voice of/);
  });

  it("gives the avatar an aria-label carrying the mood reason", () => {
    const { container } = render(
      <EntityShell entity={{ slug: "boulder-creek", name: "Boulder Creek", archetype: "creek", paused: false }} snapshot={snapshot} asOf={fixture.as_of}>
        <span />
      </EntityShell>,
    );
    const img = container.querySelector("img[role='img']")!;
    expect(img.getAttribute("aria-label")).toContain("I can't feel my gauge");
    expect(img.getAttribute("src")).toBe("/rigs/fallback/creek-asleep.svg");
  });
});
