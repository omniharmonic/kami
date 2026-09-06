// @vitest-environment jsdom
/**
 * The disclosure invariant on the board route (ADR-E13): `/e/[slug]/proposals`
 * is wrapped by the EntityShell layout, so the label renders here exactly as it
 * does on the homepage. The page is rendered with no database at all, which is
 * also the ADR-E14 case: the section still renders, honestly empty.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EntityShell } from "@/components/EntityShell";
import fixture from "@/fixtures/status/boulder-creek.json";
import type { HealthSnapshot } from "@kami/needs";
import ProposalsPage from "../page";

afterEach(cleanup);

const LABEL = "I'm an AI voice for Boulder Creek, built on public sensor data — not the creek, not a legal person.";
const snapshot = fixture.snapshot as HealthSnapshot;

async function renderBoard() {
  const page = await ProposalsPage({
    params: Promise.resolve({ slug: "boulder-creek" }),
    searchParams: Promise.resolve({}),
  });
  return render(
    <EntityShell entity={{ slug: "boulder-creek", name: "Boulder Creek", archetype: "creek", paused: false }} snapshot={snapshot} asOf={fixture.as_of}>
      {page}
    </EntityShell>,
  );
}

describe("/e/[slug]/proposals", () => {
  it("renders the disclosure label above the board, as every entity route must", async () => {
    const { container } = await renderBoard();
    const label = screen.getByTestId("disclosure");
    expect(label.textContent).toBe(LABEL);
    const board = container.querySelector("#board-h")!;
    expect(label.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the board's state groups and an honest empty state with no database", async () => {
    await renderBoard();
    expect(screen.getByText("Open — claim one")).toBeTruthy();
    expect(screen.getByText("In review — evidence submitted")).toBeTruthy();
    expect(screen.getAllByText("none right now").length).toBeGreaterThan(0);
    expect(screen.getByText(/No proposals from people yet/)).toBeTruthy();
  });

  it("asks a signed-out visitor to sign in before proposing, rather than showing a dead form", async () => {
    await renderBoard();
    expect(screen.getByText("Sign in to propose something.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("never says 'voice of' or 'as' — it speaks for the place (CLAUDE.md)", async () => {
    const { container } = await renderBoard();
    expect(container.textContent).not.toMatch(/voice of/);
    expect(container.textContent).toContain("AI voice for Boulder Creek");
  });
});
