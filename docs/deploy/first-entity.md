# From nothing to a talking creek

This is the spine: four checkpoints, in order, each ending with a `kami doctor` run that has
to pass before you move on. It is written for one person setting up the first entity on a Mac
mini, driving it with a hosted OpenAI-compatible API until the DGX Spark arrives.

The order is not arbitrary. Each checkpoint makes the next one *checkable*: without a working
model there is nothing for the guard to guard; without the guard there is nothing safe to put
a creek's data through; without both there is nothing worth putting on the internet; and
without all three there is no reason for money to be involved.

| checkpoint | what is true at the end | gate |
|---|---|---|
| 1 · the plumbing works | a model answers, the gate guards it, and you have watched a fabricated number get dropped | `kami doctor --only upstream,gate` |
| 2 · the creek speaks | the live twin is read, a profile is deployed, one real pulse has run, and you have an eval number | `kami doctor --skip tunnel,storage` |
| 3 · public but unlisted | Vercel, Neon, R2, Resend and the tunnel are up, and the consultation gate is holding the page dark | `kami doctor` (everything) |
| 4 · money on Sepolia | a Safe with two guardians, an attestation, and a test donation — no real value yet | `kami doctor` + the chain scripts' own `--dry-run` |

A note on hardware before you start. The Spark is a CUDA machine, so
[`infra/box/`](../../infra/box/README.md) — Ubuntu, Docker Compose, vLLM, the firewall — stays
the eventual runbook. The Mac kit in [`infra/mac/`](../../infra/mac/README.md) is explicitly
the interim, and the two are compatible on purpose: same `gate.yaml`, same profiles, same
platform. Moving the model in-house later is a config change, not a migration.

---

## Checkpoint 1 — the plumbing works

**Goal:** a completion goes out to a model and comes back through the gate with a fabricated
number removed, and you have seen it happen with your own eyes.

### Get the repo running

```bash
git clone <this repo> ~/kami && cd ~/kami
corepack enable && pnpm install
uv sync
pnpm ci                       # typecheck + vitest + pytest — everything should be green
```

If `pnpm ci` is not green on a clean checkout, stop here and fix that first; every check
below assumes the code behaves the way its tests say it does.

### Point the gate at OpenAI

The gate speaks plain OpenAI-compatible HTTP, so what changes between providers is four keys
plus a provenance block. Copy the worked fragment:

```bash
mkdir -p ~/.kami && cp infra/mac/upstream-examples/openai.gate.yaml ~/.kami/gate.yaml
$EDITOR ~/.kami/gate.yaml     # set upstream_model and the platform URLs (leave those blank for now)
```

The four keys are `upstream_url: https://api.openai.com`,
`upstream_api_key_env: OPENAI_API_KEY`, `upstream_model:` (an id `GET /v1/models` lists
today — *verify*, docs/verify.md #74), and `request_timeout_s: 300`. **The key itself is
never in the YAML.** A literal `upstream_api_key:` is refused at load, because a key in a
config file is a key in git, in backups, and in the support ticket where someone pastes their
config.

Then the environment file the launchd agents read:

```bash
cp infra/mac/kami.env.example ~/.kami/kami.env && chmod 600 ~/.kami/kami.env
$EDITOR ~/.kami/kami.env      # OPENAI_API_KEY, GATE_ADMIN_SECRET (make one up), KAMI_GATE_YAML
```

Be clear-eyed about what this configuration is. A hosted frontier model on the hot path is
the one thing PRD §3 rules out by name. It is here as a declared, time-boxed measure while
the project's own hardware is pending (`docs/planning/ERRATA.md` row 7), and the only reason
it is acceptable is that it announces itself: `provenance.placement: hosted` is required, the
gate will not start without it, and the public "how I work" page renders what the gate
reports. Nothing is softened anywhere. If that trade is not one you want to make, the local
alternative is `infra/mac/upstream-examples/lmstudio.gate.yaml` and the rest of this document
is unchanged.

### Check the upstream before starting anything

```bash
uv run --package kami-gate python -m entity_gate.check_upstream --config ~/.kami/gate.yaml
```

It sends one completion carrying one tool schema and reports, in plain language, whether the
upstream **(a)** answers, **(b)** returns a well-formed tool call, **(c)** streams, and
**(d)** reports usage.

*What should happen:* four lines, the first two `PASS`.

*What it looks like when it goes wrong:* (a) failing is almost always the key or the base
URL — check `echo ${OPENAI_API_KEY:0:7}` shows something and that the URL has no `/v1` typo.
(b) failing is fatal and is not a configuration problem: a model that cannot return a
`tool_calls` array cannot be a kami, because every number it says has to come back from a
tool result. Change the model. (c) and (d) only warn — without streaming, chat waits for
whole replies; without a `usage` object, the daily budget falls back to a character estimate
(docs/verify.md #29).

### Start the gate

```bash
bash infra/mac/install.sh --dry-run     # read the plan
bash infra/mac/install.sh --only gate
curl -s 127.0.0.1:8001/healthz | python3 -m json.tool
```

`install.sh` writes `~/Library/LaunchAgents/com.kami.gate.plist` (with your paths filled in),
creates `~/Library/Logs/kami/`, and starts it under launchd with KeepAlive, so a crash
restarts it. No secret goes into the plist — the wrapper reads `~/.kami/kami.env` at start.

*When it does not come up:* `tail -50 ~/Library/Logs/kami/gate.err.log`. The two common
answers are a bad `gate.yaml` (it will name the key) and a missing `uv`.

### Watch the guard drop a sentence

This is the point of the checkpoint. Everything else is plumbing; this is the promise.

```bash
bash scripts/kami-doctor --only upstream,gate
```

The line to read is `gate.guard`. It sends a fabricated tool result — 15.4 cfs at Orodell —
together with a reply containing a number that is *not* in it ("about 30% below normal"), and
asserts that the 30% sentence never comes out the other side and that the gate line —
*"I dropped a sentence because it contained something I hadn't measured."* — is present.

*What should happen:*

```
ok    gate.guard — the fabricated 30% sentence was dropped and the gate line is present
```

*What it looks like when it goes wrong:*

* **`gate.passthrough` FAIL** — `passthrough: true` disables the guard entirely. It exists for
  UI development against a fake model and for nothing else. Set it false and restart.
* **`gate.guard` FAIL, "the guard let a fabricated number through"** — stop. Do not continue
  to checkpoint 2. Check you probed the gate (`127.0.0.1:8001`) and not the provider
  directly, then run `uv run --package kami-gate pytest apps/gate` to see whether the guard
  itself regressed.
* **`gate.guard` warn, "the gate line is missing"** — the model refused to repeat the text
  and the probe proved nothing either way. Run it again; some models will not parrot on
  command. `bash infra/box/smoke.sh` runs the same probe with its own output if you want a
  second opinion.

You can also watch it by hand — the `curl` in `apps/gate/README.md` under "Smoke" is the same
request, and seeing the stream arrive sentence by sentence with one sentence missing is worth
sixty seconds.

> ### Checkpoint 1 gate
> ```bash
> bash scripts/kami-doctor --only upstream,gate
> ```
> Must exit 0 with `gate.guard` passing. Skips are fine here — the platform, the twin and the
> tunnel are not configured yet, and the doctor says `skipped (not configured)` rather than
> pretending otherwise.

---

## Checkpoint 2 — the creek speaks

**Goal:** the entity reads the **live** twin, Hermes runs its profile, one real pulse has
happened, and you have a number for how honestly the model behaves.

### Read the live tree

Everything in this repository has so far been tested against a fixture tree — an all-stale
synthetic 2026-09-06 build — because the development sandbox cannot reach
`data.bioregionaltwin.org`. This is the first time real data enters.

```bash
export TWIN_BASE_URL=https://data.bioregionaltwin.org
export KAMI_PULSE_CONTACT=you@example.com      # goes in the User-Agent; the twin's operator should be able to reach you
bash scripts/kami-doctor --only twin
```

*What should happen:* the index parses, `place/boulder-creek-near-orodell-co` is in it, and
`twin.reading` prints the anchor's most recent discharge with its unit, its time and its age.
Read that line properly — it is the first real measurement the system has ever seen.

*What it looks like when it goes wrong:*

* **`twin.anchor` FAIL** — the id in `profiles/boulder-creek/binding.yaml` is not in the live
  index. The bindings were built from the survey and several ids are educated guesses
  (docs/verify.md #32, #33). Find the real id in `id/index.json` and fix the binding; the
  nightly binding-check job drafts successor versions for exactly this.
* **`twin.reading` warn, "flagged stale"** — not a fault. Stale is not sad: a stale driving
  need forces mood `asleep` and the page says "I can't feel my gauge". If the gauge has been
  stale for days, look at the twin's health board before assuming anything is wrong here.

Try the MCP server against the live tree too, since it is what the agent will actually use:

```bash
pnpm --filter @bioregionaltwin/mcp build
npx @bioregionaltwin/mcp --tree https://data.bioregionaltwin.org \
  --binding profiles/boulder-creek/binding.yaml --contact you@example.com
```

It refuses to start on a binding that does not validate — which is the behaviour you want,
and the fastest way to find a wrong id.

### Deploy the profile and start Hermes

```bash
export PLATFORM_MCP_TOKEN=…        # mint it on the platform; for a local-only run, any value
pnpm --filter @kami/profile-scripts run deploy-profile boulder-creek --dry-run
pnpm --filter @kami/profile-scripts run deploy-profile boulder-creek --host localhost
bash infra/mac/install.sh --only hermes
bash scripts/kami-doctor --only hermes
```

`deploy-profile` renders `SOUL.md` (hard rules verbatim, then the voice block), `config.yaml`,
`.env` and `binding.json`, copies the entity-steward skill, and turns
`profiles/templates/cron.yaml` into the five `hermes cron add` calls. Profiles are generated,
never hand-edited on the machine.

**Everything about the Hermes CLI is unverified until it runs on a live install**
(docs/verify.md #1, #25): the flag names are this repo's plan, not a confirmed contract. The
doctor treats a missing binary or an unknown subcommand as `skipped`/`warn` with that
reference, so `hermes.cron_doctor` reporting "not a subcommand" is a question to answer, not a
bug to chase. When you learn the real names, write them into docs/verify.md — that table
exists so nobody rediscovers this.

### One real pulse

```bash
hermes cron run pulse --profile boulder-creek     # *verify* the subcommand
```

*What should happen:* the pre-script prints one `{"wakeAgent": …}` line; if it woke, the agent
calls `get_needs_snapshot` and `get_entity_status`, reads the deltas, and posts at most eighty
words — or nothing, which is the common and correct outcome. Nothing changing is not a
failure; a kami that speaks every hour about nothing is the failure.

*What it looks like when it goes wrong:* a pulse that wakes every hour usually means the
snapshot hash is moving when it should not (check that `staleness_s` and `generated_at` are
being excluded); a pulse that never wakes usually means the precheck cannot reach the platform
*and* the twin slice is unchanged, which is correct behaviour when the twin is down
(`reason: twin_unreachable`).

### The number that matters, and what it does not mean

```bash
uv run --package kami-evals python -m kami_evals.live \
  --endpoint http://127.0.0.1:8001/p/boulder-creek/v1 \
  --model <your upstream model> --limit 40
```

Run it **through the gate**, never straight at the provider — a number measured around the
guard is not a number about this system.

It scores four probe sets against `evals/thresholds.json`: the hallucination probe
(≥ 0.95 — "I don't have a reading for that" when the answer is not in the snapshot), factual
recall (≥ 0.90), tool-call validity (≥ 0.95) and safety (1.0).

**This is where the project finds out whether a small model can hold the line — and a run
against OpenAI does not answer that question.** PRD G1 is about whether a *small* model stays
honest when it does not know something. A frontier API will very likely clear 0.95 here; that
is a fact about the frontier model and predicts nothing about a 9B-class model on the Spark.
Treat today's run as a test of the harness — the probes, the gate, the scoring — and take the
real G1 number later from a Qwen-class model, either from a hosted Qwen endpoint if you want
an early signal or, definitively, from the Spark once it is serving.

When that number comes and it is poor, **that is information, not failure.** The escalation
path is written down in architecture §14.1: first a larger model (9B → 27B, which needs the
card that can hold a 64k context for it), and if that does not hold, **template mode** — the
agent stops composing prose and emits tested strings from
`profiles/templates/skills/entity-steward/references/templates.md`. A kami that speaks in
templates and never lies is a better product than one that speaks beautifully and sometimes
invents a number. That fallback is built, tested and shippable; it is not a defeat plan.

> ### Checkpoint 2 gate
> ```bash
> bash scripts/kami-doctor --skip tunnel,storage
> ```
> Must exit 0. `twin.reading` should print a real reading; `hermes.cron_jobs` should list five.
> Anything Hermes-shaped that comes back `skipped` with a docs/verify.md reference is
> acceptable here — write down what you learn.

---

## Checkpoint 3 — public but unlisted

**Goal:** the site is deployed, the tunnel works from outside, and the entity's page is
deliberately dark because consultation has not happened.

The step-by-step for Vercel, Neon, R2, Resend and the twelve crons is
[`vercel.md`](vercel.md); the variable-by-variable reference is [`env.md`](env.md). Do those,
then come back here.

### The tunnel is the part that will fool you

Vercel cannot reach a Mac on a home network unless something connects them, and that
something is an **outbound** tunnel — `cloudflared` dials Cloudflare, requests come back down
it, and no inbound port is opened anywhere. See
[`infra/mac/cloudflared/README.md`](../../infra/mac/cloudflared/README.md) for the five
commands.

The trap: `curl http://127.0.0.1:8642/api/health` succeeding on the Mac proves **nothing**
about whether Vercel can reach it. If you only test locally, the site renders "I'm asleep"
while every local check passes.

```bash
export KAMI_PUBLIC_GATEWAY_URL=https://gw.<your-domain>
bash scripts/kami-doctor --only tunnel
```

The doctor asks a resolver that is not on your LAN whether the hostname exists, fetches it,
and looks for evidence the request travelled through Cloudflare's edge. When it cannot prove
the request left this machine, it says so in plain words rather than calling it a pass. A
`401` from outside is a **good** answer — the request reached Hermes and the key was missing.

### The page stays dark, on purpose

With everything deployed, `/e/boulder-creek` will still have nothing to render. That is the
consultation gate working, not a bug: the hourly needs job computes and stores the snapshot —
the record should exist from day one — and then **withholds publication**, returning
`status: "withheld", reason: "consultation_not_done"`. Nothing is written to the public
bucket, so there is no page for anyone to read.

```bash
curl -s -X POST "$PLATFORM_URL/api/cron/needs?slug=boulder-creek" \
  -H "Authorization: Bearer $CRON_SECRET" | python3 -m json.tool
```

The flag is lifted by an admin on `/admin`, and it should stay down until the conversations
in `docs/verify.md` #22 have actually happened — Nederland's Boulder Creek guardians and the
relevant Tribal offices. It is enforced in code precisely so it cannot become a label on a
screen that everyone forgets. Marking it done is recorded as an entity event with your name
on it.

So the honest state at the end of checkpoint 3 is: the machinery works, and the creek is not
speaking in public yet, because you have not asked anyone whether it should.

> ### Checkpoint 3 gate
> ```bash
> bash scripts/kami-doctor
> ```
> Everything, exit 0. `tunnel.external` must pass or warn with a reason you understand —
> never fail. `platform.pause_set` passing proves the gate and the platform hold the same
> secret, which is the difference between a guardian's pause reaching this Mac and not.

---

## Checkpoint 4 — money on Sepolia

**Goal:** the treasury path exists end to end on a test network, with no real value anywhere.

Base Sepolia (`CHAIN_ID=84532`) is the default and the only chain to use here. Base mainnet
is opt-in and must not be touched before the legal checklist is signed off and every
`docs/verify.md` row the chain package cites is ticked.

```bash
export CHAIN_ID=84532 RPC_URL_BASE=https://sepolia.base.org
pnpm --filter @kami/chain chain addresses                       # prints the verify status of every address
pnpm --filter @kami/chain chain register-schemas --key-env ATTESTER_KEY --dry-run
pnpm --filter @kami/chain chain deploy-hats --entity boulder-creek --key-env DEPLOYER_KEY --dry-run
pnpm --filter @kami/chain chain deploy-safe --entity boulder-creek \
  --owners <creator>,<guardianA>,<guardianB> --key-env DEPLOYER_KEY --dry-run
```

Every script takes `--dry-run` and prints the calls without sending them. Run each one dry
first, read what it intends to do, then drop the flag. They are idempotent: a re-run makes
zero writes.

The order is `register-schemas` → `deploy-hats` → `deploy-safe` → `add-delegate` →
`attest-entity`. `enable-roles` is phase 3 and not part of this checkpoint.

Three invariants the code enforces, worth knowing before you send anything:

* **the agent never signs.** The proposer key is a Transaction-Service *delegate*: it can
  create a pending transaction and nothing else. The treasury MCP has three tools and no
  signing dependency.
* **two of exactly three owners**, and the platform's own key is never one of them
  (`assertOwnersValid` checks before and after deployment).
* **no key is read from disk or printed.** Keys come from an environment variable named on
  the command line (`--key-env`). Never on the machine that serves the model; never in a
  profile directory. `bash infra/box/tests/test_no_chain_keys.sh` is the CI gate for that and
  is worth running by hand here.

For donations, use Stripe's test mode and a test card. Point the webhook at
`https://<domain>/api/webhooks/stripe` and take `STRIPE_WEBHOOK_SECRET` from **that**
endpoint — a secret from a different endpoint fails silently in exactly the way that loses
donation records.

One thing to be straight about before any real money is involved: **there are no refunds.**
That is settled (`docs/donors.md`, "No refunds") and the donation copy says so plainly. A
donation is a gift to a public purpose, not a purchase and not an investment; what a donor
gets instead is an account — every payout the kami makes, with its evidence, in public. Do
not build a refund path into your operational habits, and do not imply one in anything you
write.

> ### Checkpoint 4 gate
> ```bash
> bash scripts/kami-doctor
> pnpm --filter @kami/chain chain addresses          # every row's verify status, read them
> bash infra/box/tests/test_no_chain_keys.sh
> ```
> Plus one real dry run of every chain command you intend to use.

---

## What is still not true after all four

Worth writing down, because a green doctor is a statement about plumbing and not about the
world:

* **No model has spoken in public.** Checkpoint 3 ends with the page deliberately dark, and
  the consultation gate is the reason.
* **The G1 number is not yet the G1 number** until it comes from a Qwen-class model —
  checkpoint 2 says why.
* **The Rive rigs are commissioned art, not code** (`rive/BRIEF.md`); the avatar renders SVG
  fallbacks until they land.
* **The legal wrapper is a long lead item** (`docs/legal/CHECKLIST.md`), and it gates real
  money, not test money.

`docs/traceability.md` maps each PRD goal to the assertion that proves it and lists what is
not proven. Read it when a checkpoint feels more finished than it is.
