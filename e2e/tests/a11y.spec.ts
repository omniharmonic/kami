import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SLUG } from "./helpers";

/**
 * X.5 — accessibility. An axe-core pass on the landing page, an entity page and
 * the chat page, plus the three properties axe cannot check for us: that no
 * information is carried by colour alone, that the phone strip's controls are
 * at least 44 px, and that headings are in order.
 *
 * One known failure is quarantined below with its measurement, not hidden:
 * `--ink-faint` fails WCAG AA contrast. It lives in `apps/web`, which this
 * package does not own, so it is reported rather than fixed — and the axe pass
 * still runs, with that one rule excluded, so nothing else can regress behind it.
 */

const PAGES = [
  { label: "landing", path: "/" },
  { label: "entity", path: `/e/${SLUG}` },
  { label: "chat", path: `/e/${SLUG}/chat` },
] as const;

// Colour contrast was excluded here while --ink-faint failed WCAG AA (3.12:1
// at worst against the 4.5:1 required, on 52 nodes). The token was raised in
// apps/web/src/app/globals.css, so the rule is now enforced like any other.

async function violations(page: Page, disableRules: string[] = []) {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]);
  const result = await (disableRules.length ? builder.disableRules(disableRules) : builder).analyze();
  return result.violations;
}

function seriousOrCritical(vs: Awaited<ReturnType<typeof violations>>) {
  return vs.filter((v) => v.impact === "serious" || v.impact === "critical");
}

test.describe("accessibility", () => {
  for (const p of PAGES) {
    test(`${p.label} (${p.path}) has no serious or critical axe violations`, async ({ page }) => {
      await page.goto(p.path);
      const found = seriousOrCritical(await violations(page));
      expect(
        found.map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
        `axe violations on ${p.path}`,
      ).toEqual([]);
    });
  }

  test("no information is carried by colour alone: every meter state has a text label", async ({ page }) => {
    await page.goto(`/e/${SLUG}`);
    const meters = page.locator("li.meter");
    const count = await meters.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const meter = meters.nth(i);
      const need = await meter.getAttribute("data-need");
      const stale = (await meter.getAttribute("data-stale")) === "true";
      const text = (await meter.innerText()).replace(/\s+/g, " ");
      const ringLabel = (await meter.locator("svg").getAttribute("aria-label")) ?? "";

      if (stale) {
        // The grey ring always comes with the words.
        expect(text, `${need}: grey ring with no "can't feel it" text`).toContain("can't feel it");
        expect(ringLabel, `${need}: ring has no accessible name`).toContain("can't feel it");
      } else {
        // A ring with no published band says so in words rather than by dot pattern.
        const unbanded = (await meter.locator("svg.ring-unbanded").count()) > 0;
        if (unbanded) expect(text, `${need}: dotted ring with no explanation`).toContain("no published band");
      }
      // Every ring carries its reading as an accessible name, whatever its colour.
      expect(ringLabel.length, `${need}: empty ring label`).toBeGreaterThan(0);
    }

    // The mood is a word as well as a pose and a colour.
    await expect(page.getByTestId("mood-word")).toHaveText(/asleep|content|concerned|distressed|celebrating/);
    await expect(page.getByTestId("mood-reason")).not.toBeEmpty();
    // The avatar is labelled, not decorative.
    const avatarLabel = await page.locator(".avatar-stage [aria-label]").first().getAttribute("aria-label");
    expect(avatarLabel?.length ?? 0).toBeGreaterThan(0);
  });

  for (const p of PAGES) {
    test(`${p.label} tap targets are at least 44 px on the phone strip`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(p.path);
      // Everything a thumb is meant to hit. Inline links inside prose are text,
      // not controls, and are excluded on purpose (WCAG 2.5.8 "inline exception").
      const controls = page.locator("a.btn, a.tap, button, textarea, input:not([type=hidden]), summary.tap");
      const n = await controls.count();
      expect(n, `${p.path} has no controls to measure`).toBeGreaterThan(0);
      const small: string[] = [];
      for (let i = 0; i < n; i++) {
        const el = controls.nth(i);
        if (!(await el.isVisible())) continue;
        const box = await el.boundingBox();
        if (!box) continue;
        const name = (await el.evaluate((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className || "-"}`)) as string;
        if (box.height < 44 || box.width < 44) small.push(`${name} ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
      expect(small, `${p.path}: controls under 44 px`).toEqual([]);
    });
  }

  for (const p of PAGES) {
    test(`${p.label} headings are ordered`, async ({ page }) => {
      await page.goto(p.path);
      const levels = await page.evaluate(() =>
        [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => ({
          level: Number(h.tagName.slice(1)),
          text: (h.textContent ?? "").trim().slice(0, 40),
        })),
      );
      expect(levels.length, `${p.path} has no headings`).toBeGreaterThan(0);
      expect(levels[0]!.level, `${p.path} starts at h${levels[0]!.level}, not h1`).toBe(1);
      expect(levels.filter((l) => l.level === 1).length, `${p.path} has more than one h1`).toBe(1);
      for (let i = 1; i < levels.length; i++) {
        const jump = levels[i]!.level - levels[i - 1]!.level;
        expect(jump, `${p.path}: h${levels[i - 1]!.level} → h${levels[i]!.level} at "${levels[i]!.text}"`).toBeLessThanOrEqual(1);
      }
    });
  }

  test("the page has a skip link, a language and a title", async ({ page }) => {
    await page.goto(`/e/${SLUG}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("a.skip")).toHaveAttribute("href", "#main");
    await expect(page.locator("#main")).toHaveCount(1);
    expect(await page.title()).toContain("Boulder Creek");
  });
});
