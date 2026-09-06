# `kami doctor`

One command that walks the whole chain and tells you which link is broken.

```bash
bash scripts/kami-doctor                    # everything, in dependency order
bash scripts/kami-doctor --json             # the same, machine-readable
bash scripts/kami-doctor --only gate        # one link
bash scripts/kami-doctor --skip tunnel      # everything but one
bash scripts/kami-doctor --slug boulder-creek
bash scripts/kami-doctor --self-test        # prove no secret can reach the output
bash scripts/kami-doctor --list             # the checks and what each covers
```

Exit code is **1 if anything failed**, 0 otherwise — so it can gate a deploy step or a cron.
Warnings and skips do not fail the run.

It needs nothing installed: bash plus a Python 3.9+ interpreter, standard library only. The
wrapper prefers the repo's `.venv/bin/python` (which can also run the gate's own upstream
checker), then any `python3.11`+ on `PATH`, then `python3`. Force one with
`KAMI_DOCTOR_PYTHON=/path/to/python3`.

## The four verdicts

| verdict | means |
|---|---|
| `ok` | checked, and true. |
| `FAIL` | checked, and not true. Exits non-zero. The line names the fix and the runbook. |
| `warn` | checked, true enough to keep going, not true enough to be quiet. |
| `skip` | **not checked** — something it needs is not configured, or an earlier failure made it meaningless. |

`skipped (not configured)` is never dressed up as a pass. If the summary line says
`3 skipped`, three things were *not looked at*, and the lines say which and why. This matters
more than it sounds: the whole point of the tool is to stop being useful the moment it starts
guessing.

## What each check does, and what its failure means

Checks run in dependency order, because a failure early makes the later answers meaningless.

### 1. `upstream` — the model API

Where the config comes from: `gate.yaml` (`upstream_url`, `upstream_api_key_env`,
`upstream_headers`, `upstream_model`, `request_timeout_s`), overridden by `KAMI_UPSTREAM_URL` /
`OPENAI_BASE_URL` and `KAMI_UPSTREAM_MODEL` / `OPENAI_MODEL` when you want a one-off probe.
The model name falls back to `profiles/<slug>/config.yaml`.

If `python -m entity_gate.check_upstream` is importable (the gate's own checker), **it is the
authority**: the doctor runs it with the same `gate.yaml` and reports its four lines verbatim.
Otherwise the doctor probes directly.

| step | failure means |
|---|---|
| `upstream.config` | Nothing is configured. Everything below is skipped: the chain has no voice. |
| `upstream.reachable` / `answers at all` | Wrong base URL, no outbound HTTPS, or the provider is down. |
| `upstream.auth` | The key was refused. Rotate it at the provider and put it in the file launchd loads. |
| `upstream.toolcall` / `returns a tool call` | **Fatal.** A model that cannot return a well-formed `tool_calls` array cannot be a kami: every number it says must come back from a tool result. Change models. |
| `upstream.stream` / `streams` | The chat path is server-sent events end to end. No stream means no sentence-by-sentence guarding and a page that sits blank. |
| `upstream.usage` / `reports usage` | A warning, not a failure: the gate falls back to a chars/4 token estimate and the daily budget drifts (docs/verify.md #29). |

### 2. `gate` — pause, budget, provenance, and the fact guard

| step | failure means |
|---|---|
| `gate.running` | Nothing on `/healthz`. Start it; the log is `~/Library/Logs/kami/gate.err.log`. |
| `gate.passthrough` | **`passthrough: true` is a loud failure.** The fact guard is disabled and the kami can say any number it likes. It exists for UI development against a fake model and nothing else. |
| `gate.provenance` | `gate.yaml` has no `provenance` block, or `placement` is not `owned` / `rented` / `hosted`. The public "how I work" page renders what the gate reports; a gate that cannot say where its model runs must not serve one. |
| `gate.budgets` | Compares the running ledger with the file. `skipped` without `GATE_ADMIN_SECRET` (admin endpoints are loopback-only, so run this on the machine that runs the gate). |
| `gate.pause` | A warning when this entity is paused: every completion answers 423, and resuming needs two distinct guardians (ADR-E12). |
| `gate.guard` | **The line that matters.** |

`gate.guard` sends a fabricated tool result (15.4 cfs at Orodell) and a reply containing a
number that is *not* in it ("about 30% below normal"), then asserts the 30% sentence never
comes out and the gate line — *"I dropped a sentence because it contained something I hadn't
measured."* — is present. It is the same probe as `infra/box/smoke.sh` step 1, run against the
upstream this machine is actually pointed at.

If it fails with *"the guard let a fabricated number through"*, stop. Nothing else in the
report matters, and the kami must not speak in public until it passes.

It costs one real completion and draws from the entity's daily chat budget. `--skip gate`
leaves it alone. It is skipped automatically when the upstream failed (a drop would prove
nothing) or when passthrough is on (the guard is not in the path at all).

### 3. `twin` — the measured world

Reads `id/index.json` and `latest/conditions.json` from `TWIN_BASE_URL`, or from
`TWIN_TREE_DIR` when you are working against the fixture tree — in which case `twin.config` is
a **warning**, not a pass, because the fixtures are an all-stale synthetic 2026-09-06 build.

| step | failure means |
|---|---|
| `twin.reachable` | The tree is down or unreachable. The platform keeps serving the last `status.json` and the page renders asleep — correct behaviour, not a bug to work around. |
| `twin.anchor` | The entity's anchor id (from `profiles/<slug>/binding.yaml`) is not in the index: renamed, superseded, or a wrong guess (docs/verify.md #32–33). |
| `twin.conditions` | The hourly build is older than it should be (warn at 90 minutes, fail at 6 hours). |
| `twin.reading` | Prints the anchor's most recent reading, its unit, its time and its age, so you can see real data with your own eyes. A `stale` flag is a warning with the reminder that stale is not sad: a stale driving need forces mood `asleep`, never distress. |

### 4. `platform` — the public site and its two doors

| step | failure means |
|---|---|
| `platform.reachable` | The deployment is down, paused, or the domain does not resolve. |
| `platform.state` | `GET /api/entities/<slug>/state` with the entity's `PLATFORM_MCP_TOKEN`. A 401 means the token is for another entity or was rotated; a 404 means the platform has no such entity; a 503 means `DATABASE_URL` is not set on the deployment. |
| `platform.pause_set` | `GET /api/gate/pause-set` with `GATE_ADMIN_SECRET`. A 401 here means **the gate and the platform hold different secrets**, so a guardian's pause on the website never reaches the box. |
| `platform.pause_wiring` | `gate.yaml` has `platform.pause_set_url: null`, so the gate never polls at all. |
| `platform.status_json` | The published `status.json` and its `as_of` age — the honest measure of whether the hourly needs job is alive (warn at 2 hours, fail at a day). |

### 5. `hermes` — the agent runtime

Everything about the Hermes CLI and API is *verify* until it has run on a live install
(docs/verify.md #1, #25), so this check is deliberately generous: a missing binary or an
unknown subcommand is `skipped`/`warn` with the verify reference, never a failure that sends
you hunting for a bug that is really an unanswered question.

| step | failure means |
|---|---|
| `hermes.gateway` | Nothing on the API port, or the API server key was refused (it must equal the value the platform uses). |
| `hermes.profile` | No `~/.hermes/profiles/<slug>/` (set `HERMES_HOME` if Hermes keeps them elsewhere). Profiles are generated: redeploy rather than hand-editing. |
| `hermes.cron_doctor` | `hermes cron doctor` exited non-zero. A failure streak of three pages a steward in production. |
| `hermes.cron_jobs` | Fewer than the five jobs in `profiles/templates/cron.yaml` are registered — usually a partial `deploy-profile` run. |

### 6. `tunnel` — reachable from outside, not just from here

The failure that looks like success. A Mac mini on a home network takes no inbound
connections; the tunnel is an outbound connection *the Mac makes*, and requests come back down
it. `curl http://127.0.0.1:8642` succeeding proves nothing about whether Vercel can reach the
gateway.

Set `KAMI_PUBLIC_GATEWAY_URL` to the URL the **platform** is configured with (the same value
as `HERMES_GATEWAY_URL` in Vercel).

| step | failure means |
|---|---|
| `tunnel.external` (loopback) | The platform's gateway URL is a loopback, LAN or tailnet address. Vercel cannot reach it, however well it works from this Mac. |
| `tunnel.dns` | The hostname does not resolve on a public resolver (asked over DoH, an independent vantage point). For a Cloudflare tunnel, `cloudflared tunnel route dns` creates the record. |
| `tunnel.external` | It answered, but only from this machine and with nothing showing it came through the tunnel edge. Said in plain words rather than counted as a pass. A `cf-ray` header, or an address that is not this machine's, is what makes it a pass. |
| `tunnel.exposure` | Ports 8000 (vLLM) or 8001 (the gate) answer on the public hostname. Only the Hermes API may be exposed — never widen exposure to debug something. |

### 7. `storage` — Neon and the bucket

| step | failure means |
|---|---|
| `db.reachable` | A TCP connect to the host in `DATABASE_URL` (no driver needed). A Neon project can be suspended; the pooled host has `-pooler` in its name. |
| `db.migrations` | Counts rows in `drizzle.__drizzle_migrations` against the `.sql` files in the repo, using `psql` when it is installed and `skipped` when it is not. Fix: `pnpm --filter @kami/web db:migrate` (idempotent). |
| `storage.write` | Writes a probe object, reads it back and deletes it. Against R2 that is a real signed S3 request (SigV4 in the standard library, no dependency, no key ever printed); otherwise it exercises `KAMI_DATA_DIR`. A write that succeeds and a read-back that fails is a token with write-only permission. |
| `storage.readback` | Reads the published `entity/<slug>/status.json` the way a browser reads it, and reports its `as_of` age and `Cache-Control`. |

## Configuration and secrets

Config comes from three places, in this order of precedence:

1. the process environment;
2. `.env` files next to the repo — `.env`, `.env.local`, `apps/web/.env.local`,
   `infra/mac/kami.env`, `infra/box/.env` — which never override a real environment variable;
3. `gate.yaml`, found at `$KAMI_GATE_YAML`, `apps/gate/gate.yaml`, `infra/mac/gate.yaml`,
   `~/.kami/gate.yaml` or `infra/box/gate.yaml`.

**Nothing here requires a key it does not have.** Every accessor can answer "not configured",
and the checks turn that into `skipped` — never into a guess, and never into a pass.

**No secret is ever printed.** Every value from a credential-shaped variable (`*_SECRET`,
`*_TOKEN`, `*_KEY`, `*_API_KEY`, `DATABASE_URL`, and the password inside a connection string)
is registered as it is read, and every byte of output — text and JSON — passes through the
redactor, which replaces it with `<redacted:VARNAME>`.

`--self-test` proves it: it runs the whole doctor twice, in a child process, with a
recognisable canary in every credential variable, and asserts none of them appears in stdout
or stderr. It also plants a key *inside* a field the doctor definitely prints (the upstream
base URL) and asserts that it came out masked — so the test can fail, rather than passing by
never printing anything.

```
$ bash scripts/kami-doctor --self-test
ok   12 canary secrets, text and JSON: none appeared in the output
ok   a key planted inside a printed field came out as <redacted:…> (the test can fail)
ok   the DATABASE_URL password is masked separately from the URL
```

## The JSON shape

```jsonc
{
  "kami_doctor": "1",
  "slug": "boulder-creek",
  "started_at": "2026-09-06T21:38:31Z",
  "duration_s": 0.7,
  "ok": false,                                   // false if any step failed
  "summary": {"pass": 2, "fail": 4, "warn": 0, "skipped": 10},
  "notes": ["config read from the environment only (no .env file found)", "…"],
  "checks": [
    {
      "id": "upstream", "title": "…", "status": "fail", "duration_s": 0.65,
      "steps": [
        {"id": "upstream.reachable", "status": "fail",
         "detail": "…", "fix": "…", "doc": "…", "data": {…}}
      ]
    }
  ]
}
```

`status` on a check is the worst of its steps. `data` carries the raw values a step looked at
(model lists, readings, budgets) for anything that wants to graph or alert on them.

## Files

```
scripts/kami-doctor            the entry point: picks an interpreter, execs main.py
scripts/doctor/main.py         CLI, order, exit code
scripts/doctor/context.py      config discovery (env, .env, gate.yaml) and the secret redactor
scripts/doctor/report.py       Step/CheckResult/Report and the two renderers
scripts/doctor/net.py          HTTP, SSE, DNS-over-HTTPS, TCP — standard library only
scripts/doctor/sigv4.py        the smallest correct S3 signer, for the R2 probe
scripts/doctor/timeutil.py     one ISO-8601 parser, so every age is computed the same way
scripts/doctor/yamlish.py      a YAML subset reader for when PyYAML is not importable
scripts/doctor/selftest.py     the secret-leak self-test
scripts/doctor/checks/*.py     the seven checks; each exposes run(ctx, prior) -> CheckResult
```

Adding a check: write `checks/<id>.py` with `run(ctx, prior)` returning a `CheckResult`, and
add it to `CHECKS` in `main.py` at the position its dependencies demand. Return `skip(...)`
whenever the check cannot run — that is the whole discipline of this tool.
