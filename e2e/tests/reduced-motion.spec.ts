import { expect, test } from "@playwright/test";
import { NAME, SLUG } from "./helpers";

/**
 * PRD §6.3 / X.5 / architecture §9.4 — `prefers-reduced-motion` is honoured:
 * the avatar rests. The static SVG pose is what the server renders first and
 * what stays; the Rive runtime is not imported and no canvas is created.
 *
 * Caveat, stated plainly: `apps/web/src/lib/avatar/rigs.ts` marks every rig
 * `available: false` today (the commission is out, T1.8), so the SVG would win
 * even without the media query. The last test below pins the distinction as far
 * as this build allows — it asserts that the rig manifest, not the motion
 * preference, is the current reason — so that when the first `.riv` lands the
 * reduced-motion branch is the one under test and this file will say so.
 */

test.describe("prefers-reduced-motion: reduce", () => {
  test.use({ reducedMotion: "reduce" });

  test("the static SVG pose renders and no Rive canvas is created", async ({ page }) => {
    await page.goto(`/e/${SLUG}`);

    const stage = page.locator(".avatar-stage");
    await expect(stage).toHaveAttribute("data-avatar-mode", "svg");

    const svg = stage.locator("img.avatar-fallback");
    await expect(svg).toBeVisible();
    await expect(svg).toHaveAttribute("src", "/rigs/fallback/creek-asleep.svg");
    await expect(svg).toHaveAttribute("aria-label", new RegExp(NAME));
    // `alt` carries the same name. An explicit role="img" was removed: paired
    // with an empty alt it made axe report presentation-role-conflict, and an
    // <img> with a real alt already has the img role implicitly.
    await expect(svg).toHaveAttribute("alt", new RegExp(NAME));
    // The image itself resolves — the pose is really there, not a broken icon.
    expect(await svg.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

    // No Rive canvas in the avatar. The illustrated landscape has its own
    // WebGL canvas and disables motion when this preference is active.
    await expect(page.locator(".avatar-stage canvas")).toHaveCount(0);
    expect(page.url()).toContain(`/e/${SLUG}`);
  });

  test("the browser really is in reduced-motion mode and no .riv is ever fetched", async ({ page }) => {
    const rivRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith(".riv")) rivRequests.push(r.url());
    });
    await page.goto(`/e/${SLUG}`);
    await page.waitForLoadState("networkidle");

    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    expect(rivRequests, "a rig was fetched despite reduced motion").toEqual([]);
    await expect(page.locator(".avatar-stage canvas")).toHaveCount(0);
  });

  test("without the preference the page still renders the SVG, because no rig is commissioned yet (T1.8)", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "no-preference", viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(`/e/${SLUG}`);
    const stage = page.locator(".avatar-stage");
    await expect(stage).toHaveAttribute("data-avatar-mode", "svg");
    // This is the honest current reason. When a `.riv` ships, this becomes
    // "reduced-motion" only under the preference, and this expectation flips.
    await expect(stage).toHaveAttribute("data-avatar-reason", "rig-unavailable");
    await expect(page.locator(".avatar-stage canvas")).toHaveCount(0);
    await ctx.close();
  });
});
