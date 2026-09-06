import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { FIXTURE_STATUS_FILE } from "../ports";
import { COPY, ENTITY_ROUTES, NAME, SLUG } from "./helpers";

/**
 * ADR-E14 / PRD §6.5 — dashboards are static-first; chat is the only dynamic
 * path. This whole harness runs with no `DATABASE_URL` at all, so Neon is
 * unreachable by construction: if the entity page renders, it rendered from
 * `entity/<slug>/status.json` alone.
 *
 * What is asserted: the page renders, it names its `as_of` honestly, the
 * readings match the file byte for byte, and the empty sections say they are
 * empty rather than inventing content.
 */

const fixture = JSON.parse(readFileSync(FIXTURE_STATUS_FILE, "utf8")) as {
  as_of: string;
  entity: { name: string; archetype: string };
  snapshot: { needs: Array<{ need: string; label: string }>; mood: string };
  pulses: Array<{ at: string; woke: boolean; text: string | null }>;
};

test.describe("static-first: the database is unreachable", () => {
  test("the entity page renders from status.json with a visible 'as of'", async ({ page }) => {
    const res = await page.goto(`/e/${SLUG}`);
    expect(res?.status(), "the page must not 404 or 500 without a database").toBe(200);

    await expect(page.getByRole("heading", { level: 1, name: NAME })).toBeVisible();

    const asOf = page.locator(`time[datetime="${fixture.as_of}"]`).first();
    await expect(asOf).toBeVisible();
    await expect(asOf).toHaveText(COPY.asOf);
    expect(fixture.as_of).toBe("2026-09-06T06:00:00Z");
  });

  test("every reading on the page came from the file", async ({ page }) => {
    await page.goto(`/e/${SLUG}`);
    const body = await page.locator("body").innerText();
    for (const need of fixture.snapshot.needs) {
      await expect(page.locator(`li.meter[data-need="${need.need}"]`)).toHaveCount(1);
      // The ring's accessible name is the fixture's own label, verbatim.
      expect(body.includes(need.label) || (await page.locator(`li.meter[data-need="${need.need}"] svg`).getAttribute("aria-label"))?.includes(need.label)).toBe(true);
    }
  });

  test("the pulse log comes from the file too", async ({ page }) => {
    await page.goto(`/e/${SLUG}`);
    const woke = fixture.pulses.filter((p) => p.woke && p.text);
    for (const p of woke) {
      await expect(page.locator(`time[datetime="${p.at}"]`)).toHaveCount(1);
      await expect(page.getByText(p.text!)).toBeVisible();
    }
  });

  test("sections that need the database say they are empty; nothing is invented", async ({ page }) => {
    await page.goto(`/e/${SLUG}`);
    const body = page.locator("body");
    await expect(body).toContainText("No bounties yet.");
    await expect(body).toContainText("No guardians accepted yet.");
    await expect(body).toContainText("No quarterly strategy yet.");
    await expect(body).toContainText("No other kami share my anchor place yet.");
    await expect(body).toContainText("not read yet"); // Safe balance
  });

  test("every entity route survives the missing database", async ({ page }) => {
    for (const route of ENTITY_ROUTES) {
      const res = await page.goto(route.path);
      expect(res?.status(), `${route.path} without a database`).toBe(200);
      await expect(page.locator('[data-disclosure="ai-voice"]').first()).toBeVisible();
    }
  });

  test("an unknown slug is a 404, not a guess", async ({ page }) => {
    const res = await page.goto("/e/not-a-kami");
    expect(res?.status()).toBe(404);
    await expect(page.locator("body")).toContainText("There's no kami by that name.");
  });

  test("the how-i-work page stays unpublished until consultation is marked done (PRD §13 #4)", async ({ page }) => {
    // No database ⇒ no `consultation_done_at` ⇒ the page must say so rather than
    // pretend consultation happened.
    await page.goto(`/e/${SLUG}/how-i-work`);
    await expect(page.locator('[data-consultation="unpublished"]')).toBeVisible();
    await expect(page.locator("body")).toContainText("It stays unpublished until a steward marks consultation");
    await expect(page.locator("body")).toContainText("I never speak for nations.");
  });
});
