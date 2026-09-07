import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { REPO_ROOT } from "../src/lib/paths.js";

it("launches the dedicated foreground profile with only loopback API access", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beings-launcher-"));
  try {
    fs.writeFileSync(path.join(dir, "curl"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    fs.writeFileSync(path.join(dir, "hermes"), '#!/bin/sh\nprintf "%s\\n" "$API_SERVER_ENABLED" "$API_SERVER_HOST" "$API_SERVER_PORT" "$@"\n', { mode: 0o700 });
    const run = (profile?: string) => spawnSync("/bin/bash", [path.join(REPO_ROOT, "infra/mac/bin/run-hermes.sh")], {
      encoding: "utf8", timeout: 3000,
      env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, KAMI_ENV_FILE: path.join(dir, "missing"), API_SERVER_KEY: "test-only", ...(profile ? { KAMI_HERMES_PROFILE: profile } : {}) },
    });
    const ok = run("boulder-creek");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("true\n127.0.0.1\n8642\n--profile\nboulder-creek\ngateway\nrun\n");
    const missing = run();
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("KAMI_HERMES_PROFILE");
    const invalid = run("default;anything");
    expect(invalid.status).toBe(2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
