#!/usr/bin/env node
/**
 * `pnpm --filter @kami/e2e test` — the command the CI `e2e` job runs.
 *
 * Three steps, in order:
 *   1. Is a Chromium available? If not, print how to install it and exit 0.
 *      The root `pnpm test` recurses into every workspace package, including
 *      this one, and the `web` CI job has no browsers; a hard failure there
 *      would be noise. The `e2e` job runs `playwright install --with-deps
 *      chromium` first, so this guard never fires where it matters.
 *   2. Build: `pnpm build:packages` (the web app imports @kami/* from dist/)
 *      then `next build`. Playwright's webServer only starts `next start`, so
 *      the build cannot be left to it — and the app must be the production
 *      build, not `next dev`.
 *   3. `playwright test`, forwarding any extra arguments
 *      (e.g. `pnpm --filter @kami/e2e test -- --workers=1`).
 *
 * `KAMI_E2E_SKIP_BUILD=1` skips step 2 when the build is already current.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eDir = path.join(here, "..");
const repoRoot = path.join(e2eDir, "..");
const args = process.argv.slice(2);

function run(cmd, argv, cwd) {
  console.log(`\n$ ${cmd} ${argv.join(" ")}`);
  const r = spawnSync(cmd, argv, { cwd, stdio: "inherit", env: process.env });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

async function chromiumPresent() {
  try {
    const { chromium } = await import("@playwright/test");
    const exe = chromium.executablePath();
    return typeof exe === "string" && exe.length > 0 && existsSync(exe);
  } catch {
    return false;
  }
}

if (!(await chromiumPresent())) {
  console.log(
    [
      "[@kami/e2e] no Chromium found — skipping the Playwright suite.",
      "            install it with:",
      "              pnpm --filter @kami/e2e exec playwright install --with-deps chromium",
      "            (the CI `e2e` job does exactly that before `pnpm --filter @kami/e2e test`)",
    ].join("\n"),
  );
  process.exit(0);
}

/**
 * A `next start` already running on one of our ports is serving the *previous*
 * `.next`; once the build below replaces it, that process serves a mix of old
 * and new chunks and tests fail for reasons that have nothing to do with the
 * app. So a rebuild ends any server on the harness's own two ports, and
 * Playwright starts fresh ones.
 */
function freePorts() {
  for (const port of [process.env.KAMI_E2E_PORT ?? "3100", process.env.KAMI_E2E_PAUSED_PORT ?? "3101"]) {
    spawnSync("bash", ["-c", `fuser -k -n tcp ${port} 2>/dev/null || lsof -ti tcp:${port} 2>/dev/null | xargs -r kill`], {
      stdio: "ignore",
    });
  }
}

if (!process.env.KAMI_E2E_SKIP_BUILD) {
  let code = run("pnpm", ["run", "build:packages"], repoRoot);
  if (code !== 0) process.exit(code);
  process.env.SKIP_ENV_VALIDATION = "1";
  code = run("pnpm", ["--filter", "@kami/web", "build"], repoRoot);
  if (code !== 0) process.exit(code);
  freePorts();
}

process.exit(run("pnpm", ["exec", "playwright", "test", ...args], e2eDir));
