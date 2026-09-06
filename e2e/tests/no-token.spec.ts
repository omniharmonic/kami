import { expect, test } from "@playwright/test";
import { ENTITY_ROUTES, SLUG } from "./helpers";

/**
 * PRD §13 #8, Goals "non-goals for v1", `docs/no-token.md` — no token, ever.
 *
 * The landing page states the policy; no page anywhere offers one, prices one,
 * or governs by one. This is a copy test on purpose: the failure mode it guards
 * against is a well-meant sentence, not a contract.
 */

/** Words that would mean a token exists, or that a place has a price. */
const FORBIDDEN = [
  /\btokenomics\b/i,
  /\bairdrop/i,
  /\bpresale\b/i,
  /\bICO\b/,
  /\blaunchpad\b/i,
  /\bgovernance token\b/i,
  /\butility token\b/i,
  /\bbuy \$?[A-Z]{3,6}\b/,
  /\bstaking\b/i,
  /\bstake (?:your|the) /i,
  /\byield\b/i,
  /\bAPY\b/,
  /\btoken (?:sale|price|holders?|supply)\b/i,
  /\bcoin\b/i,
  /\bmarket cap\b/i,
  /\bwhitelist\b/i,
  /\bmint (?:your|an?) (?:NFT|token)\b/i,
];

/** Every route this build serves without a database. */
const ALL_ROUTES = ["/", "/sign-in", ...ENTITY_ROUTES.map((r) => r.path)];

test.describe("no token, ever", () => {
  test("the landing page states the policy", async ({ page }) => {
    await page.goto("/");
    const section = page.locator("section", { hasText: "No token, ever" }).first();
    await expect(section).toBeVisible();
    await expect(section).toContainText("Not for governance, not for reputation, not for cosmetics.");
    await expect(section).toContainText("Nothing here has a price.");
    // It is on every page's footer too, not only the landing section.
    await expect(page.locator("footer")).toContainText("No token, ever.");
  });

  for (const path of ALL_ROUTES) {
    test(`${path} offers no token, no price and no token governance`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      const body = await page.locator("body").innerText();
      for (const pattern of FORBIDDEN) {
        expect(body, `${path} contains ${pattern}`).not.toMatch(pattern);
      }
      // "token" may only appear inside the policy itself or the model-usage note.
      for (const line of body.split("\n").filter((l) => /token/i.test(l))) {
        expect(
          /no token|not a crypto token|token, ever|Anything claiming to be a Kami token is a scam/i.test(line),
          `${path}: an unpoliced use of "token": ${line}`,
        ).toBe(true);
      }
    });
  }

  test("the money copy says what money cannot do, including becoming a token", async ({ page }) => {
    await page.goto(`/e/${SLUG}`);
    await page.getByText("Give", { exact: true }).click();
    const treasury = page.locator("section", { hasText: "Treasury" }).first();
    await expect(treasury).toContainText("become a token, a share, or a price on a place — no token, ever");
    await expect(treasury).toContainText("move without two human signatures on the Safe — I only propose");
    // No urgency theatre in donation copy (PRD §13 #2).
    const donation = await treasury.innerText();
    for (const phrase of ["before it's too late", "will die", "act now", "urgent", "last chance", "hurry", "don't wait", "running out"]) {
      expect(donation.toLowerCase(), `donation copy contains "${phrase}"`).not.toContain(phrase);
    }
    // Nothing recurs by default.
    await expect(treasury).toContainText("One-time only. Nothing recurs unless you come back.");
  });

  test("the how-i-work page repeats the policy and names the licences", async ({ page }) => {
    await page.goto(`/e/${SLUG}/how-i-work`);
    const body = page.locator("body");
    await expect(body).toContainText("No token, ever");
    await expect(body).toContainText("Anything claiming to be a Kami token is a scam.");
    await expect(body).toContainText("Twin facts: CC0");
    await expect(body).toContainText("CC BY-SA");
    await expect(body).toContainText('I say "for", not "as".');
  });
});
