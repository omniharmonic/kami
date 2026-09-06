// @vitest-environment jsdom
/**
 * **The ethics test** (PRD §13 #2, binding). It renders exactly what a donor
 * sees on `/e/[slug]/donate` — the page delegates its whole body to
 * `DonatePanel` — and asserts:
 *
 *  - none of the forbidden urgency language appears anywhere on it, under the
 *    task's list *and* `copy.forbiddenUrgency` from `src/copy/index.ts`;
 *  - the fee is stated as a number before the button;
 *  - the "what money cannot do" list is present, item for item;
 *  - there is no recurring option and no pre-selected amount.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { forbiddenUrgency, treasury } from "@/copy";
import { donateCopy } from "../copy";
import { FEE_TABLE, feeText } from "../fees";
import { DonatePanel } from "@/components/donate/DonatePanel";

/** The list the task fixes, verbatim. */
export const FORBIDDEN = [
  "urgent",
  "now or never",
  "dying",
  "last chance",
  "hurry",
  "running out",
  "donate now",
  "save the",
] as const;

const DIRECT = {
  safeAddress: "0x1111111111111111111111111111111111111111",
  chainName: "Base Sepolia",
  chainId: 84532,
  tokenAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  qrDataUrl: "data:image/png;base64,AAAA",
};

function renderPanel(legalEntityName: string | null = "Kami Commons Ltd") {
  render(
    <DonatePanel
      name="Boulder Creek"
      slug="boulder-creek"
      legalEntityName={legalEntityName}
      minUsd={1}
      maxUsd={10000}
      cardEnabled
      direct={DIRECT}
      formProps={{ submitImpl: async () => ({}), navigate: () => {} }}
    />,
  );
  return document.body.textContent ?? "";
}

/** Every string leaf of the copy object, so nothing hides behind a callback. */
function copyStrings(): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === "function") {
      try {
        walk((v as (...a: unknown[]) => unknown)("Boulder Creek", 20, "Kami Commons Ltd"));
      } catch {
        /* a formatter that needs other arguments; the rendered page covers it */
      }
    } else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(donateCopy);
  return out;
}

afterEach(cleanup);

describe("the donation page contains no urgency language", () => {
  it.each(FORBIDDEN)("does not say %s", (term) => {
    const text = renderPanel().toLowerCase();
    expect(text).not.toContain(term);
  });

  it("passes the copy module's own forbidden list too", () => {
    const text = renderPanel().toLowerCase();
    for (const pattern of forbiddenUrgency) {
      expect(new RegExp(pattern, "i").test(text), `donation copy matched ${pattern}`).toBe(false);
    }
  });

  it("keeps the same promise when there is no legal wrapper", () => {
    const text = renderPanel(null).toLowerCase();
    for (const term of FORBIDDEN) expect(text).not.toContain(term);
    expect(text).toContain("not tax-deductible");
  });

  it("has no urgency language in any string of the copy module, rendered or not", () => {
    const all = copyStrings().join("\n").toLowerCase();
    for (const term of FORBIDDEN) expect(all).not.toContain(term);
    for (const pattern of forbiddenUrgency) {
      expect(new RegExp(pattern, "i").test(all), `donateCopy matched ${pattern}`).toBe(false);
    }
  });
});

describe("the donation page states the fee and what money cannot do", () => {
  it("states the card fee in numbers before the button", () => {
    renderPanel();
    const text = document.body.textContent ?? "";
    expect(text).toContain("2.9%");
    expect(text).toContain("30¢");
    expect(text).toContain(feeText("card"));
    // and the worked example, so the donor sees the arithmetic, not just the rate
    expect(text).toContain("$19.12");

    // the fee appears before the submit button in document order
    const button = screen.getByRole("button", { name: donateCopy.amount.submit });
    const feeNode = screen.getByText(donateCopy.fees.card, { selector: "form p" });
    expect(feeNode.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("states every fee in the table, including the zero one", () => {
    renderPanel();
    const text = document.body.textContent ?? "";
    expect(text).toContain("1.5%");
    expect(text).toContain("no platform fee");
    expect(FEE_TABLE.card.percent).toBe(2.9);
    expect(FEE_TABLE.card.fixed_usd).toBe(0.3);
  });

  it("lists what money cannot do, item for item, from the shared copy module", () => {
    renderPanel();
    const text = document.body.textContent ?? "";
    expect(text).toContain(donateCopy.cannot.heading);
    expect(treasury.moneyCannotDo.length).toBeGreaterThan(0);
    for (const item of treasury.moneyCannotDo) expect(text).toContain(item);
    for (const item of treasury.moneyCanDo) expect(text).toContain(item);
  });

  it("says a human signs every payout, names the wrapper, and offers USDC as an equal route", () => {
    renderPanel();
    const text = document.body.textContent ?? "";
    expect(text).toContain(donateCopy.humanSigns.body);
    expect(text).toContain("Kami Commons Ltd");
    expect(text).toContain(DIRECT.safeAddress);
    expect(screen.getByAltText(donateCopy.direct.qrAlt("Boulder Creek"))).toBeTruthy();
  });

  it("has no recurring option, no pre-selected amount, no countdown and no goal bar", () => {
    renderPanel();
    const amount = screen.getByLabelText(donateCopy.amount.label) as HTMLInputElement;
    expect(amount.value).toBe("");
    for (const b of screen.getAllByRole("button")) expect(b.getAttribute("aria-pressed")).not.toBe("true");
    expect(document.querySelectorAll("input[type=checkbox], input[type=radio]")).toHaveLength(0);
    expect(document.querySelectorAll("progress, meter")).toHaveLength(0);
    // no control offers a repeat: no checkbox, radio, select, or interval field
    expect(document.querySelectorAll("select")).toHaveLength(0);
    expect(document.querySelectorAll("[name*=recur i], [name*=interval i], [name*=subscription i], [id*=recur i]")).toHaveLength(0);
    const text = (document.body.textContent ?? "").toLowerCase();
    for (const term of ["goal", "countdown", "matched", "sign up to give", "make it monthly"]) expect(text).not.toContain(term);
    // and the page says so in words
    expect(text).toContain("there is no recurring option");
  });
});
