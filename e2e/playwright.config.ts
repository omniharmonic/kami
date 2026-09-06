import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, FIXTURE_DATA_DIR, PAUSED_BASE_URL, PAUSED_PORT, PORT } from "./ports";

/**
 * Kami e2e (plan §1.1 CI matrix — the `e2e` job; T1.3 / T1.5 tests).
 *
 * The app under test is the **production build** of `@kami/web`, started twice
 * against the same fixture directory and no database at all:
 *
 *   port 3100  HERMES_GATEWAY_URL=fake:        the canned guarded reply, streamed
 *                                              sentence by sentence with the
 *                                              trailing `event: toolcalls`
 *   port 3101  HERMES_GATEWAY_URL=fake:paused  every completion answers 423
 *
 * `KAMI_DATA_DIR` points at `fixtures/data`, which holds
 * `entity/boulder-creek/status.json` (the all-stale 2026-09-06 build copied from
 * `apps/web/src/fixtures/status/boulder-creek.json`). Neither server has
 * `DATABASE_URL`, so every page must render from the status file alone — that is
 * ADR-E14, and `offline.spec.ts` asserts it.
 *
 * Phone first: the default viewport is 390 × 844 (PRD §6.1, X.5).
 */


/** No secret is ever in this file; these are fixture values and are meant to be public. */
const webEnv = {
  SKIP_ENV_VALIDATION: "1",
  KAMI_DATA_DIR: FIXTURE_DATA_DIR,
  CHAT_COOKIE_SECRET: "e2e-fixture-cookie-key-not-a-secret",
  NEXT_TELEMETRY_DISABLED: "1",
};

const phone = { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } };

function server(port: number, gateway: string) {
  return {
    command: `pnpm --filter @kami/web exec next start --port ${port} --hostname 127.0.0.1`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
    timeout: 180_000,
    env: { ...webEnv, HERMES_GATEWAY_URL: gateway },
  };
}

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 2,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: phone,
      testIgnore: ["**/paused.spec.ts"],
    },
    {
      // Same browser, the server whose gateway answers 423 for every completion.
      name: "chromium-paused",
      use: { ...phone, baseURL: PAUSED_BASE_URL },
      testMatch: ["**/paused.spec.ts"],
    },
  ],
  webServer: [server(PORT, "fake:"), server(PAUSED_PORT, "fake:paused")],
});
