import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { FIXTURE_STATUS_FILE } from "../ports";
import { COPY, NAME, SLUG } from "./helpers";

/**
 * T1.3 / T1.5 (d) / ADR-E11 / G4 — stale is a state, never sadness.
 *
 * The fixture is the all-stale 2026-09-06 build: the driving need (flow at
 * Orodell) and air are `stale: true` with `source_status: critical`, so the
 * snapshot's mood is `asleep` and its reason is "I can't feel my gauge".
 * Nothing is interpolated: every meter still shows its last value, unit, time
 * and source as text.
 */

type Need = {
  need: string;
  value: number | null;
  unit: string | null;
  time: string | null;
  source_id: string | null;
  stale: boolean;
};
const fixture = JSON.parse(readFileSync(FIXTURE_STATUS_FILE, "utf8")) as {
  snapshot: { needs: Need[]; mood: string; mood_reason: string; stale_driving: boolean };
};
const needs = fixture.snapshot.needs;
const staleNeeds = needs.filter((n) => n.stale);

test.describe("the stale fixture", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/e/${SLUG}`);
  });

  test("the fixture really is stale on its driving need", async () => {
    expect(fixture.snapshot.stale_driving).toBe(true);
    expect(fixture.snapshot.mood).toBe("asleep");
    expect(fixture.snapshot.mood_reason).toBe(COPY.cantFeelMyGauge);
    expect(staleNeeds.length).toBeGreaterThan(0);
  });

  test('stale needs render the grey "can\'t feel it" ring', async ({ page }) => {
    for (const n of staleNeeds) {
      const meter = page.locator(`li.meter[data-need="${n.need}"]`);
      await expect(meter).toHaveAttribute("data-stale", "true");
      // The grey dashed ring…
      await expect(meter.locator("svg.ring-stale")).toHaveCount(1);
      // …and the words that carry the same meaning, so colour is never alone.
      await expect(meter.locator(".chip-stale")).toHaveText(COPY.cantFeelIt);
      await expect(meter.locator("svg.ring-stale")).toHaveAttribute("aria-label", new RegExp(COPY.cantFeelIt.replace("'", "'")));
      // No arc is drawn for a reading it cannot feel.
      await expect(meter.locator("circle.ring-fill")).not.toHaveAttribute("stroke-dasharray", /\d/);
      // The ring is painted with the one colour that means "stale", and only that.
      const stroke = await meter.locator("circle.ring-fill").evaluate((el) => getComputedStyle(el).stroke);
      const staleToken = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--stale").trim());
      expect(hexToRgb(staleToken), `${n.need}: ring is ${stroke}, not the stale grey`).toBe(stroke);
    }
    // Fresh needs keep the normal ring; the grey one means one thing only.
    for (const n of needs.filter((x) => !x.stale)) {
      const meter = page.locator(`li.meter[data-need="${n.need}"]`);
      await expect(meter).toHaveAttribute("data-stale", "false");
      await expect(meter.locator("svg.ring-stale")).toHaveCount(0);
    }
  });

  test("the avatar says it cannot feel its gauge, and is asleep — never distressed", async ({ page }) => {
    const avatar = page.locator(".avatar-stage");
    await expect(avatar).toHaveAttribute("data-mood", "asleep");
    await expect(avatar).toHaveAttribute("data-stale", "true");

    const labelled = avatar.locator("[aria-label]").first();
    const label = await labelled.getAttribute("aria-label");
    expect(label, "the avatar's accessible name").toContain(COPY.cantFeelMyGauge);
    expect(label).toContain(NAME);

    // The mood is also a word on the page, not only a pose.
    await expect(page.getByTestId("mood-word")).toHaveText("asleep");
    await expect(page.getByTestId("mood-reason")).toHaveText(COPY.cantFeelMyGauge);

    // G4: a stale driving reading never produces distress, anywhere on the page.
    await expect(page.locator('[data-mood="distressed"]')).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("distressed");
  });

  test("every meter shows value, unit, time and source as text", async ({ page }) => {
    const meters = page.locator("li.meter");
    await expect(meters).toHaveCount(needs.length);

    for (const n of needs) {
      const meter = page.locator(`li.meter[data-need="${n.need}"]`);
      const text = (await meter.innerText()).replace(/\s+/g, " ");

      expect(text, `${n.need}: no "reading:" line`).toContain("reading:");
      expect(text, `${n.need}: no "time:" line`).toContain("time:");
      expect(text, `${n.need}: no "source:" line`).toContain("source:");

      // The value and its unit, verbatim from the fixture — nothing rounded away.
      expect(text, `${n.need}: value ${n.value} missing`).toContain(String(n.value));
      if (n.unit) expect(text, `${n.need}: unit ${n.unit} missing`).toContain(n.unit);
      // The reading's own time, not the page's.
      expect(text, `${n.need}: time ${n.time} missing`).toContain(n.time!);
      await expect(meter.locator(`time[datetime="${n.time}"]`)).toHaveCount(1);
      // The source id and its status.
      expect(text, `${n.need}: source ${n.source_id} missing`).toContain(n.source_id!);
      // Stale needs additionally say how long they have been quiet.
      if (n.stale) expect(text, `${n.need}: no staleness duration`).toContain("stale for");
    }
  });

  test("nothing is interpolated: no reading is shown as zero for a stale need", async ({ page }) => {
    for (const n of staleNeeds) {
      const meter = page.locator(`li.meter[data-need="${n.need}"]`);
      // The ring's own numeral is an em dash while it cannot feel the gauge.
      await expect(meter.locator("svg text")).toHaveText("—");
      // …but the last real reading is still there, in the text.
      expect(await meter.innerText()).toContain(String(n.value));
    }
  });
});

/** "#9a958e" → "rgb(154, 149, 142)", the form getComputedStyle returns. */
function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
