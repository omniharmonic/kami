# `infra/mac` — the Mac mini as the entity's driver

The interim home for the first kami's voice. A Mac mini runs two things — the **gate** (the
proxy every completion passes through) and the **Hermes gateway** (the agent runtime and its
five cron jobs) — while the model itself is a hosted OpenAI-compatible API. When the DGX
Spark arrives, the model moves in-house and the Mac's job shrinks or ends.

**This kit is explicitly the interim.** The Spark is a CUDA machine, so
[`infra/box/`](../box/README.md) — the Ubuntu/CUDA runbook with vLLM, Docker Compose and the
firewall — remains the eventual target and is not superseded by anything here. The two are
compatible on purpose: the same `gate.yaml`, the same profiles, the same platform. Moving
from one to the other is a config change (`upstream_url`, `provenance.placement`), not a
migration.

```
infra/mac/
├── com.kami.gate.plist        launchd agent for the gate      (KeepAlive, restart on crash)
├── com.kami.hermes.plist      launchd agent for Hermes        (waits for the gate first)
├── bin/run-gate.sh            loads ~/.kami/kami.env, execs the gate
├── bin/run-hermes.sh          loads it, waits for /healthz, execs the gateway
├── install.sh                 writes the agents, loads them, says what it did
├── uninstall.sh               stops and removes them, says what it left behind
├── kami.env.example           every variable the two need; copy to ~/.kami/kami.env, chmod 600
├── cloudflared/               the outbound tunnel — the only thing the internet may reach
├── upstream-examples/         complete gate.yaml fragments: OpenAI (today), LM Studio (local)
└── power.md                   the pmset settings that stop the Mac sleeping through its cron
```

## The shape of it

```
   the internet
        │  https://gw.<domain>          (Cloudflare tunnel — outbound only, no open ports)
        ▼
  ┌───────────── Mac mini ─────────────┐
  │  cloudflared  ──▶ 127.0.0.1:8642   │  Hermes gateway: profiles, five cron jobs
  │                        │           │
  │                        ▼           │
  │                  127.0.0.1:8001    │  the gate: pause · budget · concurrency · FACT GUARD
  │                        │           │
  └────────────────────────┼───────────┘
                           ▼
              https://api.openai.com    (or 127.0.0.1:1234 for LM Studio,
                                         or the Spark's vLLM later)
```

Two properties of that picture are load-bearing:

* **Hermes talks to the gate, never to the model** (ADR-E04). The profile's
  `model.base_url` is `http://127.0.0.1:8001/p/<slug>/v1`. Every completion — chat and cron
  alike — passes the fact guard. Pointing a profile straight at a provider would silently
  turn rule 1 off.
* **Only 8642 is exposed.** The gate's admin endpoints are loopback-only by design (that is
  what makes "one guardian pauses, two resume" a real boundary), and no model endpoint is
  ever on the public internet.

## Install

Assumes: the repo cloned, `corepack enable && pnpm install`, `uv sync`, and a Hermes CLI on
`PATH` (*verify* — docs/verify.md #25 covers every Hermes name this repo assumes).

```bash
cd ~/kami                                   # wherever you cloned it
bash infra/mac/install.sh --dry-run         # read the plan first
bash infra/mac/install.sh
$EDITOR ~/.kami/kami.env                    # fill in the keys install.sh created a template for
launchctl kickstart -k gui/$(id -u)/com.kami.gate
bash scripts/kami-doctor
```

`install.sh` writes `~/Library/LaunchAgents/com.kami.{gate,hermes}.plist` with the repo path
and your home directory filled in, creates `~/Library/Logs/kami/`, copies
`kami.env.example` to `~/.kami/kami.env` (chmod 600, never overwriting an existing file), and
loads both agents. It prints each thing it changed. `uninstall.sh` reverses it and says what
it deliberately left alone — your keys, your profiles, and the logs.

**No secret is ever in a plist.** A plist is world-readable and shows up in `launchctl print`;
the two wrapper scripts read `~/.kami/kami.env` at start instead, so the environment lives in
one 600-mode file that is not in the repository. That is also why editing the env file
requires a `kickstart`: the process reads it once.

## Day-to-day

```bash
# is anything wrong, and what exactly
bash scripts/kami-doctor
bash scripts/kami-doctor --only gate          # just the guard round-trip
bash scripts/kami-doctor --json | jq .summary

# restart after editing kami.env or gate.yaml
launchctl kickstart -k gui/$(id -u)/com.kami.gate
launchctl kickstart -k gui/$(id -u)/com.kami.hermes

# are they running, and why did one stop
launchctl print gui/$(id -u)/com.kami.gate | head -20
tail -f ~/Library/Logs/kami/gate.err.log
tail -f ~/Library/Logs/kami/hermes.err.log

# pause the entity (one guardian pauses; two distinct names resume — ADR-E12)
GATE_ADMIN_SECRET=… pnpm --filter @kami/profile-scripts run pause boulder-creek \
  --guardians ada --reason "…"
```

The logs are plain text and rotate only when you rotate them; `~/Library/Logs/kami/` is worth
a `find ... -mtime +30 -delete` in a monthly reminder if this Mac runs for a long time.

## The model

The gate points at a hosted OpenAI-compatible API today. Both configurations are written out
in full in [`upstream-examples/`](upstream-examples/README.md): OpenAI is the worked path,
LM Studio is the local alternative for when you want the Mac to do its own thinking.

Two rules that do not bend:

* the key is never in `gate.yaml` — `upstream_api_key_env` names an environment variable, and
  the gate refuses a literal key at load;
* `provenance.placement` (`owned` | `rented` | `hosted`) is required, and the public "how I
  work" page renders what the gate reports. A hosted frontier model on the hot path is a
  declared, time-boxed deviation (ERRATA row 7) — it is acceptable **because** it announces
  itself, and for no other reason.

## Power, sleep and login

A sleeping Mac misses its cron silently. [`power.md`](power.md) has the `pmset` settings, the
FileVault-versus-automatic-login trade-off (LaunchAgents need a login session), and how to
tell after the fact whether it slept. Read it before you walk away from the machine.

## The network

Home network, no port forwarding, outbound only:
[`cloudflared/README.md`](cloudflared/README.md) explains why that is a security property
rather than a workaround, gives the five commands, and — most importantly — shows how to
prove the gateway is reachable **from outside**, which is the one failure that looks exactly
like success from the Mac's own terminal.

## What breaks, and where to look

| symptom | first look |
|---|---|
| the page renders "I'm asleep" | `kami doctor --only tunnel,hermes` — nearly always the tunnel or the gateway, not the model |
| chat answers 423 | the entity is paused. Two distinct guardians to resume (ADR-E12) |
| chat answers 429 | the daily budget or the queue. `kami doctor --only gate` prints the ledger |
| replies lose sentences | that is the guard working. `guard_events.jsonl` says which atoms failed |
| a number appears that no tool returned | stop. `kami doctor --only gate` — `gate.guard` is the check, and this is the one failure that must never ship |
| `status.json` stopped moving | the platform's hourly cron, not this Mac: `kami doctor --only platform` |

For anything that reads like the GPU box's failures — the tunnel dropped, the model is gone —
[`docs/runbooks/box.md`](../../docs/runbooks/box.md) is still the right runbook; substitute
`launchctl` for `docker compose`.
