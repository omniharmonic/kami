import { expect, test } from "@playwright/test";
import { COPY, ENTITY_ROUTES, NAME, expectAboveTheFold } from "./helpers";

/**
 * ADR-E13 / PRD §6.6 / G7 — disclosure is a rendering invariant.
 *
 * The label is rendered by `EntityShell`, which wraps every `/e/[slug]/*`
 * route, so this file enumerates the routes the app actually builds and asserts
 * the label on each: text, the place name, the "not the creek, not a legal
 * person" clause, and that a phone reader meets it without scrolling.
 */

test.describe("disclosure label", () => {
  for (const route of ENTITY_ROUTES) {
    test(`is present on ${route.path} (${route.label})`, async ({ page }) => {
      const res = await page.goto(route.path);
      expect(res?.status(), `${route.path} must render in the fixture-only build`).toBe(200);

      const label = page.locator('[data-disclosure="ai-voice"]').first();
      await expect(label).toBeVisible();
      await expect(label).toHaveText(COPY.disclosure);

      // It names the place and refuses both kinds of standing.
      await expect(label).toContainText(NAME);
      await expect(label).toContainText("not the creek, not a legal person");
      // "for", never "as" (PRD §13 #10, docs/naming.md).
      await expect(label).toContainText(`AI voice for ${NAME}`);
      await expect(label).not.toContainText("voice of");
    });

    test(`is above the fold on 390×844 on ${route.path}`, async ({ page }) => {
      await page.goto(route.path);
      await page.setViewportSize({ width: 390, height: 844 });
      const label = page.locator('[data-disclosure="ai-voice"]').first();
      await expect(label).toBeVisible();
      await expectAboveTheFold(page, label);
    });
  }

  test("opens every chat session as well as every page", async ({ page }) => {
    await page.goto(`/e/boulder-creek/chat`);
    // One in the shell, one at the top of the chat transcript.
    await expect(page.locator('[data-disclosure="ai-voice"]')).toHaveCount(2);
    await expect(page.getByText(COPY.reminderFirst)).toBeVisible();
  });

  test("skipped route: /e/<slug>/proposals/<id> needs a bounty row and there is no database in this harness", async () => {
    test.skip(true, "no database: the bounty detail route cannot be reached from status.json alone");
  });
});
