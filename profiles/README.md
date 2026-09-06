# profiles/ — Hermes entity profiles

One Hermes profile per kami (ADR-E02), generated — never hand-edited — from the templates here and pushed
to `~/.hermes/profiles/<slug>/` on the GPU box by `scripts/deploy-profile.ts`. Architecture §5; PRD §4.5,
§4.7, §8.2; plan T0.7, T0.10, T1.11, T3.2.

```
profiles/
├── templates/
│   ├── SOUL.hard-rules.md          v1 — the platform-owned block, fenced <!-- kami:hard-rules v1 start/end -->
│   ├── SOUL.voice.example.md       a ≤3-sentence voice block for a creek
│   ├── config.yaml.tmpl            architecture §5.1 with {{slug}} {{model}} {{gate_url}} {{platform_url}} {{twin_base_url}} {{paused}}
│   ├── env.tmpl                    PLATFORM_MCP_TOKEN= and KAMI_ENTITY_SLUG= — nothing else, ever
│   ├── cron.yaml                   the five §5.2 jobs; deploy-profile turns them into `hermes cron add` calls
│   ├── soul_render.py              stdlib reference renderer (same algorithm as scripts/src/lib/soul.ts)
│   ├── skills/entity-steward/      SKILL.md · scripts/pulse_precheck.py · references/{needs-model,templates}.md
│   └── tests/                      pytest, stdlib only: test_pulse_precheck.py · test_soul_render.py
├── boulder-creek/                  voice.md (source) · SOUL.md + config.yaml (rendered goldens) · README.md
│                                   binding.yaml is owned by packages/binding and lands here separately
└── scripts/                        @kami/profile-scripts: deploy-profile.ts · pause.ts · pause-drill.ts (tsx, yaml, vitest)
```

## How a SOUL.md is built

Hard rules first, voice second (PRD §4.5). The renderer takes the fenced block from
`templates/SOUL.hard-rules.md` **verbatim** and appends the entity's `voice.md` inside a
`<!-- kami:voice start/end -->` fence. Two invariants, both tested in Python and TypeScript:

1. The hard-rules fence is byte-identical before and after rendering any voice block; the committed
   `boulder-creek/SOUL.md` is the shared golden that keeps the two renderers honest.
2. A voice block that contains a fence marker, is empty, or runs past three sentences is rejected.

The block carries no placeholders on purpose: the disclosure line's `<place>` / `<kind>` are filled by the
model from the voice block, so every profile in the fleet ships the identical block and a v2 can be swapped in
with `replaceHardRules()` without touching a steward's voice. Editing a voice block needs the Steward role.

## The skill

`skills/entity-steward/` is in agentskills.io format. `SKILL.md` says which tool for what, how to say
measured / forecast / stale / unknown, how a pulse works (`get_needs_snapshot` → `get_entity_status` → read
`deltas[]` → ≤ 80 words only if a delta is notable → `post_update`), weekly bounty drafting (≤ 3, PRD §7.6
shape, tier 1 needs a `prediction`), the quarterly memo, the donor-report paragraph, and the crisis protocol.
`references/needs-model.md` lists per-archetype needs and which bands exist today; `references/templates.md`
is template mode (architecture §14.1): every GPU-down / paused / stale / over-budget / superseded-gauge line
as a tested string.

`scripts/pulse_precheck.py` is the hourly no-LLM pre-script: it asks the platform's
`/api/entities/<slug>/precheck`; if that is unreachable it hashes the entity's slice of the twin's
`latest/conditions.json` (stations by `huc12` inside the binding's watersheds or by member id; `generated_at`
and `staleness_s` excluded) against `state/last_snapshot_hash`. It prints one `{"wakeAgent": bool, …}` line,
never raises, and answers `false` with `reason: twin_unreachable` when the twin is down.

## Running the tests

```bash
# Python (stdlib only — no uv workspace member on purpose; the members list is fixed)
python3 -m pytest profiles/templates/tests -q

# TypeScript
pnpm --filter @kami/profile-scripts typecheck test

# X.1 — nothing chain-key-shaped in profiles/ or infra/box/
bash infra/box/tests/test_no_chain_keys.sh
```

## Scripts

```bash
# Render + push + cron + reload. --dry-run prints the plan and writes only the local build dir.
PLATFORM_MCP_TOKEN=… pnpm --filter @kami/profile-scripts run deploy-profile boulder-creek --host box [--staging] [--paused] [--large-model qwen3.8-27b]

# One guardian pauses; two distinct guardians resume (ADR-E12).
GATE_ADMIN_SECRET=… pnpm --filter @kami/profile-scripts run pause boulder-creek --guardians ada --reason "…"
GATE_ADMIN_SECRET=… pnpm --filter @kami/profile-scripts run pause boulder-creek --resume --guardians ada,grace

# Quarterly drill: pause, time the gate's 423, write docs/drills/<date>.md.
pnpm --filter @kami/profile-scripts run pause-drill boulder-creek --operator ada [--resume-guardians ada,grace]
```

`deploy-profile` writes `paused: true` into `config.yaml` and adds cron jobs `--disabled` when `--paused` is
given or `profiles/<slug>/state/paused` exists (which `pause.ts` creates and `--resume` removes), so a gateway
restart never resurrects a paused entity (§5.9). `state/` is git-ignored.

## Interfaces this package assumes from others (report, not code)

- **apps/gate:** `POST /admin/pause/<slug>` pauses, `DELETE /admin/pause/<slug>` resumes, both with
  `X-Gate-Admin: <GATE_ADMIN_SECRET>` and a JSON body `{guardians[], reason, at, action}`; a paused slug answers
  `423` on `/p/<slug>/v1/chat/completions`; `GET /healthz`.
- **apps/web:** `GET /api/entities/<slug>/precheck` → `{changed: bool, snapshot_id}` (bearer
  `PLATFORM_MCP_TOKEN`); `POST /api/entities/<slug>/pause` with the same body (bearer `PLATFORM_ADMIN_TOKEN`).
- **packages/binding:** `profiles/<slug>/binding.yaml` in the architecture §3 shape; deploy-profile converts
  it to `binding.json` and refuses any `coordinates` key.

## *verify* — Hermes v0.21.0 specifics (docs/verify.md #1)

Every Hermes CLI/API name used here is a plan until checked on a live install: `hermes cron add` flag names
(`--profile --name --schedule --tz --pre-script --toolsets --continuity --context-from --skill
--reasoning-effort --model --disabled`), `hermes cron remove`, `hermes cron run <job> --profile`,
`hermes cron doctor`, `hermes profile reload <slug>` or `POST /api/profiles/<slug>/reload`, `/api/jobs/pause`,
the `paused:` key in a profile config, `disabled_toolsets` names (incl. `delegate`), whether
`cron.max_parallel_jobs` spans profiles, and per-profile API routing `/p/<profile>/v1` in multiplexed mode.
