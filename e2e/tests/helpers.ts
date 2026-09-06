import { expect, type Locator, type Page } from "@playwright/test";

/** The one entity the fixture directory publishes. */
export const SLUG = "boulder-creek";
export const NAME = "Boulder Creek";

/**
 * Every `/e/*` route the app builds today, with a short label. `proposals` is
 * included because `EntityShell` wraps it too (ADR-E13 says *every* route).
 * `/e/<slug>/proposals/<id>` is not listed: it needs a bounty row, and there is
 * no database in this harness.
 */
export const ENTITY_ROUTES = [
  { label: "home", path: `/e/${SLUG}` },
  { label: "chat", path: `/e/${SLUG}/chat` },
  { label: "how-i-work", path: `/e/${SLUG}/how-i-work` },
  { label: "proposals", path: `/e/${SLUG}/proposals` },
] as const;

/** Verbatim from `apps/web/src/copy/index.ts` — the strings under test. */
export const COPY = {
  disclosure: `I'm an AI voice for ${NAME}, built on public sensor data — not the creek, not a legal person.`,
  reminderFirst: `You're talking with an AI voice for ${NAME}.`,
  reminder: `A reminder: you're talking with an AI voice for ${NAME}.`,
  paused: "I'm paused by my guardians. I'll be back when two of them agree to wake me.",
  cantFeelIt: "can't feel it",
  cantFeelMyGauge: "I can't feel my gauge",
  lookedAt: "What I looked at",
  noToken: "No token, ever",
  asOf: "as of 2026-09-06T06:00:00Z",
} as const;

/** The three sentences `fake:` streams, from `apps/web/src/lib/gateway.ts`. */
export const FAKE_SENTENCES = [
  "The last flow reading I have from Orodell is 15.4 cubic feet per second, from 2026-09-04 20:15Z.",
  "The gauge feed has been quiet since then, so I can't feel my gauge right now.",
  "Gross Reservoir is at 72 % of normal storage as of 2026-09-06 05:00Z.",
];

/** Fixture facts the "what I looked at" footer must name. */
export const FAKE_TOOLCALL = {
  placeIds: ["place/boulder-creek-near-orodell-co", "place/gross-reservoir"],
  times: ["2026-09-04T20:15:00Z", "2026-09-06T05:00:00Z"],
  sourceId: "cdss.telemetry",
} as const;

/**
 * A fresh client address for one test.
 *
 * `apps/web` limits anonymous chat to 60 turns per day per IP (§10.3) and reads
 * the client address from `x-forwarded-for`. Without this every test in a run —
 * and every re-run against a reused server — would share one bucket and the
 * later ones would get 429s that have nothing to do with what they assert.
 */
export function testIp(): string {
  const rnd = () => 1 + Math.floor(Math.random() * 254);
  return `10.${rnd()}.${rnd()}.${rnd()}`;
}

/** Give this page (and its API calls) their own client address. */
export async function useFreshIp(page: Page): Promise<string> {
  const ip = testIp();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  return ip;
}

/** Type the message and press Send; does not wait for the reply. */
export async function sendTurn(page: Page, text: string): Promise<void> {
  const box = page.locator("textarea").first();
  await box.fill(text);
  await page.getByRole("button", { name: /^(Send|Listening…)$/ }).click();
}

/** The nth (0-based) assistant bubble. */
export function reply(page: Page, index = 0): Locator {
  return page.locator('[data-generated="ai"]').nth(index);
}

/** Send one turn and wait until its "what I looked at" footer has rendered. */
export async function sendTurnAndWait(page: Page, text: string, index = 0): Promise<void> {
  await sendTurn(page, text);
  await expect(reply(page, index).locator("[data-looked-at]")).toBeVisible({ timeout: 20_000 });
}

/**
 * Assert the element is fully inside the first screenful.
 *
 * The page is returned to the top first: `Chat` calls `scrollIntoView` on mount,
 * which nudges the window down a few dozen pixels. What is under test is
 * "a reader who has not scrolled sees the label", so the measurement is taken
 * from `scrollY === 0`.
 */
export async function expectAboveTheFold(page: Page, locator: Locator): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport, "the test needs a fixed viewport").not.toBeNull();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect
    .poll(async () => page.evaluate(() => window.scrollY), { message: "page did not settle at the top" })
    .toBe(0);
  const box = await locator.boundingBox();
  expect(box, "element has no layout box").not.toBeNull();
  expect(box!.y, "the label starts above the top of the viewport").toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height, "the label runs past the fold").toBeLessThanOrEqual(viewport!.height);
}
