"""5. Hermes — the agent runtime and its five cron jobs.

Everything about the Hermes CLI and API is *verify* until it has been run on a
live install (docs/verify.md #1, #25): the flag names in
`profiles/templates/cron.yaml` are a plan, not a confirmed contract. So this
check is deliberately generous — a missing binary or an unknown subcommand is
`skipped`/`warn` with the verify reference, never a `fail` that sends the
operator hunting for a bug that is really an unanswered question.

What it does assert plainly: the gateway answers on its API port with the key
the platform uses, the profile exists on disk where Hermes will look for it,
and the five jobs from `cron.yaml` are registered.
"""

from __future__ import annotations

import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from context import Ctx
from net import request
from report import CheckResult, Step, fail, ok, skip, warn
from yamlish import load_yaml

DOC = "infra/box/README.md §3; profiles/README.md; docs/verify.md #1, #25"
VERIFY = "docs/verify.md #25 — the Hermes CLI names are unverified until they run on a live install"


def _expected_jobs(ctx: Ctx) -> List[str]:
    path = ctx.root / "profiles" / "templates" / "cron.yaml"
    if not path.exists():
        return ["pulse", "daily-reflection", "weekly-bounties", "quarterly-strategy", "donor-report"]
    try:
        data = load_yaml(path.read_text(encoding="utf-8"))
    except Exception:
        data = None
    jobs: List[str] = []
    if isinstance(data, dict) and isinstance(data.get("jobs"), list):
        for job in data["jobs"]:
            if isinstance(job, dict) and job.get("name"):
                jobs.append(str(job["name"]))
    return jobs or ["pulse", "daily-reflection", "weekly-bounties", "quarterly-strategy", "donor-report"]


def _hermes_argv(ctx: Ctx) -> Optional[List[str]]:
    cmd = ctx.get("HERMES_CMD")
    if cmd:
        return shlex.split(cmd)
    found = shutil.which("hermes")
    return [found] if found else None


def _run(argv: List[str], timeout: float = 60.0) -> Tuple[int, str]:
    try:
        proc = subprocess.run(argv, capture_output=True, timeout=timeout)
    except FileNotFoundError:
        return 127, "command not found"
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {timeout:.0f}s"
    except OSError as exc:
        return 126, str(exc)
    out = (proc.stdout + b"\n" + proc.stderr).decode("utf-8", "replace").strip()
    return proc.returncode, out


def _looks_unsupported(output: str) -> bool:
    low = output.lower()
    return any(
        phrase in low
        for phrase in ("no such command", "unknown command", "unrecognized", "invalid choice", "usage:", "not a hermes")
    )


def run(ctx: Ctx, prior: Dict[str, CheckResult]) -> CheckResult:
    result = CheckResult(id="hermes", title="Hermes — the agent runtime and its cron jobs")

    # ---- the gateway -------------------------------------------------------
    url = ctx.hermes_url()
    raw = ctx.get("HERMES_GATEWAY_URL")
    if not url:
        result.steps.append(
            skip(
                "hermes.gateway",
                "no Hermes API URL is configured"
                + (f" (HERMES_GATEWAY_URL is {raw!r} — the web app's fake gateway)" if raw else ""),
                fix="export HERMES_GATEWAY_URL=http://127.0.0.1:8642 on the machine running Hermes; the web app "
                "keeps its `fake:` default until you set the real one in Vercel",
                doc=DOC,
            )
        )
    else:
        key = ctx.get("HERMES_API_SERVER_KEY", "API_SERVER_KEY")
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        answered: Optional[str] = None
        last = None
        for path in ("/api/health", "/v1/models", "/healthz"):
            resp = request(url + path, headers=headers, timeout=min(ctx.timeout, 10))
            last = resp
            if resp.status == 401:
                result.steps.append(
                    fail(
                        "hermes.gateway",
                        f"{url}{path} refused the API server key",
                        fix="HERMES_API_SERVER_KEY here must equal the gateway's API_SERVER_KEY (and the value in "
                        "the Vercel project). Fix infra/mac/kami.env and restart Hermes",
                        doc=DOC,
                    )
                )
                answered = "401"
                break
            if resp.ok:
                answered = path
                result.steps.append(ok("hermes.gateway", f"{url}{path} answered {resp.status}", endpoint=path))
                break
        if answered is None:
            detail = last.why() if last else "no response"
            if last is not None and last.status in (403, 404):
                result.steps.append(
                    warn(
                        "hermes.gateway",
                        f"{url} answered {last.status} on every path this tool knows — the port is open but the "
                        "health path is unverified",
                        fix="check `hermes gateway --help` for the real health path and note it in docs/verify.md #1",
                        doc=VERIFY,
                    )
                )
            else:
                result.steps.append(
                    fail(
                        "hermes.gateway",
                        f"nothing answered on {url}: {detail}",
                        fix="start it: `launchctl kickstart -k gui/$UID/com.kami.hermes` (Mac); logs in "
                        "~/Library/Logs/kami/hermes.err.log",
                        doc="infra/mac/README.md",
                    )
                )

    # ---- the profile on disk ----------------------------------------------
    home = ctx.hermes_home()
    profile_dir = home / "profiles" / ctx.slug
    if profile_dir.is_dir():
        present = [name for name in ("SOUL.md", "config.yaml", ".env", "binding.json") if (profile_dir / name).exists()]
        missing = [name for name in ("SOUL.md", "config.yaml") if not (profile_dir / name).exists()]
        if missing:
            result.steps.append(
                fail(
                    "hermes.profile",
                    f"{profile_dir} exists but is missing {', '.join(missing)}",
                    fix=f"redeploy it: `PLATFORM_MCP_TOKEN=… pnpm --filter @kami/profile-scripts run deploy-profile "
                    f"{ctx.slug}` — profiles are generated, never hand-edited on the box",
                    doc="profiles/README.md",
                )
            )
        else:
            result.steps.append(ok("hermes.profile", f"{profile_dir} ({', '.join(present)})", path=str(profile_dir)))
    else:
        result.steps.append(
            fail(
                "hermes.profile",
                f"no profile at {profile_dir}",
                fix=f"deploy it: `PLATFORM_MCP_TOKEN=… pnpm --filter @kami/profile-scripts run deploy-profile "
                f"{ctx.slug} --host localhost` (see profiles/README.md); set HERMES_HOME if Hermes keeps its "
                "profiles elsewhere",
                doc="profiles/README.md",
            )
        )

    # ---- hermes cron doctor ------------------------------------------------
    argv = _hermes_argv(ctx)
    if not argv:
        result.steps.append(
            skip(
                "hermes.cron_doctor",
                "no `hermes` binary on PATH and no HERMES_CMD, so cron health was not checked",
                fix="install the Hermes CLI, or set HERMES_CMD to how you reach it (for example "
                "`docker compose -f /opt/kami/infra/box/docker-compose.yml exec -T hermes hermes`)",
                doc=VERIFY,
            )
        )
        result.steps.append(
            skip(
                "hermes.cron_jobs",
                "not checked — no way to ask Hermes what is registered",
                fix="same as above",
                doc=VERIFY,
            )
        )
        return result

    code, out = _run(argv + ["cron", "doctor"], timeout=90)
    tail = " | ".join(line.strip() for line in out.splitlines()[-4:]) if out else "(no output)"
    if code == 0:
        result.steps.append(ok("hermes.cron_doctor", f"clean — {tail}"))
    elif code in (127, 126):
        result.steps.append(
            skip(
                "hermes.cron_doctor",
                f"could not run `{argv[0]} cron doctor`: {out}",
                fix="check HERMES_CMD",
                doc=VERIFY,
            )
        )
    elif _looks_unsupported(out):
        result.steps.append(
            warn(
                "hermes.cron_doctor",
                f"`cron doctor` is not a subcommand on this Hermes build — {tail}",
                fix="find the equivalent in `hermes cron --help` and record it in docs/verify.md #25; "
                "profiles/templates/cron.yaml maps the names this repo assumes",
                doc=VERIFY,
            )
        )
    else:
        result.steps.append(
            fail(
                "hermes.cron_doctor",
                f"`hermes cron doctor` exited {code} — {tail}",
                fix="read the full output; a failing streak of three pages a steward in production "
                "(architecture §5.8)",
                doc=DOC,
            )
        )

    # ---- the five jobs -----------------------------------------------------
    expected = _expected_jobs(ctx)
    code, out = _run(argv + ["cron", "list", "--profile", ctx.slug], timeout=60)
    if code != 0 and _looks_unsupported(out):
        code, out = _run(argv + ["cron", "list"], timeout=60)
    if code != 0:
        result.steps.append(
            warn(
                "hermes.cron_jobs",
                f"could not list cron jobs (exit {code}); expected {', '.join(expected)}",
                fix="check the real subcommand with `hermes cron --help` and note it in docs/verify.md #25",
                doc=VERIFY,
            )
        )
        return result
    found = [name for name in expected if name in out]
    missing = [name for name in expected if name not in out]
    if not missing:
        result.steps.append(ok("hermes.cron_jobs", f"all {len(expected)} registered: {', '.join(found)}", jobs=found))
    else:
        result.steps.append(
            fail(
                "hermes.cron_jobs",
                f"{len(missing)} of {len(expected)} jobs are not registered: {', '.join(missing)}",
                fix=f"redeploy the profile — deploy-profile turns profiles/templates/cron.yaml into the "
                f"`hermes cron add` calls: `pnpm --filter @kami/profile-scripts run deploy-profile {ctx.slug}`",
                doc="profiles/README.md",
                missing=missing,
            )
        )
    return result
