# Runbook — profiles

```bash
# Render, push, install cron, reload. Always dry-run first.
PLATFORM_MCP_TOKEN=… pnpm --filter @kami/profile-scripts run deploy-profile <slug> --host box --dry-run
```

**`profiles/README.md` is the manual** — how a `SOUL.md` is built, what the skill contains, what
the templates hold, and the list of Hermes command names still to be confirmed against a live
install. This file is the operational half: deploy, verify, roll back, and the four things that go
wrong.

A profile is **generated, never hand-edited.** If the copy on the box differs from what the
repository renders, the copy on the box is wrong — replace it rather than reconciling it.

---

## Deploy

```bash
# 1. Dry run. Read the diff it prints; it writes only the local build dir.
PLATFORM_MCP_TOKEN=… pnpm --filter @kami/profile-scripts run deploy-profile <slug> --host box --dry-run

# 2. For real.
PLATFORM_MCP_TOKEN=… pnpm --filter @kami/profile-scripts run deploy-profile <slug> --host box

# 3. On the box.
hermes cron doctor
```

Then, within the hour, check the pulse woke/skipped counter in `/admin`. A profile that never
skips is not reading the twin's hash; a profile that never wakes is not seeing changes. Both are
bugs.

Run it from a machine on the tailnet. `--staging` deploys `<slug>-staging` with its own gate
budget. `--large-model <name>` pins the weekly and quarterly jobs to a bigger model.

## Before you deploy, check three things

1. **The voice block.** Three sentences maximum, no fence markers, and editing one requires the
   Steward role. The renderer rejects the rest.
2. **The hard rules are byte-identical.** The committed `profiles/boulder-creek/SOUL.md` is the
   golden that keeps the TypeScript and Python renderers honest. If it moved, something is wrong
   with the renderer, not with the golden.
3. **No key, anywhere.** The profile `.env` holds `PLATFORM_MCP_TOKEN` and `KAMI_ENTITY_SLUG` and
   nothing else, ever. Run `bash infra/box/tests/test_no_chain_keys.sh` before and after.

## Roll back

Profiles are regenerable from the repository at any commit — that is the rollback.

```bash
git checkout <good-commit> -- profiles/
PLATFORM_MCP_TOKEN=… pnpm --filter @kami/profile-scripts run deploy-profile <slug> --host box
git checkout HEAD -- profiles/
```

Never restore a profile from the nightly backup to undo a bad deploy. The backup exists for a lost
machine; the repository exists for a bad change, and it is the one that is reviewed.

## A paused entity must stay paused

`pause.ts` writes `profiles/<slug>/state/paused`. `deploy-profile` reads it and writes `paused:
true` into `config.yaml` with every cron job `--disabled`. **So a deploy, or a gateway restart,
never resurrects a paused kami.** If you find a paused entity answering chat after a deploy, that
is a serious bug: pause it again by hand at the gate, then file it.

```bash
GATE_ADMIN_SECRET=… pnpm --filter @kami/profile-scripts run pause <slug> --guardians <you> --reason "…"
# Two distinct guardians to resume, within 24 hours of each other:
GATE_ADMIN_SECRET=… pnpm --filter @kami/profile-scripts run pause <slug> --resume --guardians ada,grace
```

## What goes wrong

**The deploy pushed but Hermes did not pick it up.** Reload without restarting the gateway if the
installed version supports it; otherwise restart the gateway, accepting that it interrupts every
profile on the box. Reload behaviour is one of the unconfirmed Hermes items in `profiles/README.md`
— if you settle it, write the answer into `docs/verify.md` row 1 rather than into your memory.

**Cron jobs are duplicated after a redeploy.** The deploy removes and re-adds; if a name changed,
the old job survives under the old name. `hermes cron list --profile <slug>`, remove the orphan by
hand, and fix the template so the name is stable.

**`failure_streak ≥ 3` paged a steward.** That is `hermes cron doctor` counting consecutive
failures on one job. Read the job's log first: the usual causes are the twin being unreachable
(correct behaviour — the pre-check answers `wakeAgent: false` with `reason: twin_unreachable` and
should not be failing), an expired `PLATFORM_MCP_TOKEN`, or the gate refusing because it cannot
reach the platform's pause set and is failing closed. The third is by design; fix the platform, not
the gate.

**The binding changed.** `binding.yaml` is owned by `packages/binding` and validated on deploy;
`deploy-profile` refuses any binding containing a `coordinates` key. That refusal is a hard
invariant (no geometry ever reaches a model prompt) — do not work around it, fix the binding.

**A token needs rotating.** `PLATFORM_MCP_TOKEN` is per entity and rotates on every profile deploy
and on any incident. Mint a new one in `/admin`, redeploy the profile, and confirm the old one now
returns 401.
