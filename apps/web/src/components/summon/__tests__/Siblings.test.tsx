// @vitest-environment jsdom
/**
 * Plurality is a rendering property, like disclosure: it has to be on the
 * page, not in a prompt (PRD §4.4, §13 #10).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Siblings } from "../../Siblings";
import { SiblingsFirst } from "../SiblingsFirst";
import { HardRules } from "../HardRules";
import { Progress } from "../Progress";
import { SensingTable } from "../SensingTable";
import type { SiblingEntity } from "@/lib/summon/siblings";

afterEach(cleanup);

const siblings: SiblingEntity[] = [
  {
    slug: "boulder-creek-school",
    name: "Boulder Creek (Casey Middle School)",
    archetype: "creek",
    anchor: "place/boulder-creek-near-orodell-co",
    steward: { name: "Ms Alvarez", user_id: "u-1" },
    guardians: [{ name: "Dana", user_id: "u-2" }, { name: "Rae", user_id: "u-3" }],
    paused: false,
    href: "/e/boulder-creek-school",
  },
];

describe("Siblings", () => {
  it("says no kami speaks for the place alone, and names who tends each one", () => {
    render(<Siblings siblings={siblings} placeName="Boulder Creek" />);
    expect(screen.getByText("Boulder Creek has more than one voice. None of them speaks for it alone.")).toBeTruthy();
    expect(screen.getByText("Boulder Creek (Casey Middle School)").getAttribute("href")).toBe("/e/boulder-creek-school");
    expect(screen.getByText("Ms Alvarez")).toBeTruthy();
    expect(screen.getByText("Dana, Rae")).toBeTruthy();
  });

  it("still renders the entity page's older prop shape", () => {
    render(<Siblings siblings={[{ slug: "a", name: "A", archetype: "creek" }]} />);
    expect(screen.getByText("A")).toBeTruthy();
    // no plurality line without a place name, but the shared intro still runs
    expect(screen.queryByText(/speaks for it alone/)).toBeNull();
  });

  it("says so honestly when nothing else is bound here", () => {
    render(<Siblings siblings={[]} placeName="Salmon Creek" />);
    expect(screen.getByText("No other kami share my anchor place yet.")).toBeTruthy();
  });

  it("SiblingsFirst renders nothing when there are no siblings, and the warning card when there are", () => {
    const { container, unmount } = render(<SiblingsFirst siblings={[]} placeName="Salmon Creek" />);
    expect(container.textContent).toBe("");
    unmount();
    render(<SiblingsFirst siblings={siblings} placeName="Boulder Creek" />);
    expect(screen.getByText(/more than one voice/)).toBeTruthy();
  });
});

describe("HardRules", () => {
  it("renders the block with no form control and marks it read-only", () => {
    const block = "<!-- kami:hard-rules v1 start -->\n# Hard rules\n- You cannot move money.\n<!-- kami:hard-rules v1 end -->\n";
    const { container } = render(<HardRules block={block} version={1} />);
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("[contenteditable]")).toBeNull();
    expect(container.querySelector("[aria-readonly='true']")).toBeTruthy();
    expect(container.textContent).toContain("You cannot move money.");
  });
});

describe("Progress", () => {
  it("marks the current step and links only the ones already reached", () => {
    const { container } = render(<Progress draftId="smn_1" current={2} reached={3} />);
    expect(container.querySelector("[aria-current='step']")).toBeTruthy();
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("/summon/smn_1/1");
    expect(links).not.toContain("/summon/smn_1/5");
  });
});

describe("SensingTable", () => {
  it("names the state in words, never colour alone, and lists the gaps", () => {
    render(
      <SensingTable
        rows={[
          { need: "flow", property: "discharge", places: ["place/x"], where: ["Orodell"], agg: "single", state: "stale", time: "2026-09-04T20:15:00Z", unit: "[ft_i]3/s", value: 15.4, staleness_s: 120_000, source_id: "cdss.telemetry", percentile_available: false, note: "the last discharge reading is old" },
        ]}
        gaps={["no percentile is published for flow yet, so it can't say whether today is low or high for the season"]}
      />,
    );
    expect(screen.getByText("last reading is old")).toBeTruthy();
    expect(screen.getByText(/no percentile is published for flow yet/)).toBeTruthy();
  });
});
