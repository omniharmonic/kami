# Runbook — incident

**Pause first. Read second.** This is architecture §10.6 written out for someone at 3 a.m.

```bash
# 1. STOP IT. One guardian is enough. Do this before you understand anything.
pnpm --filter @kami/profile-scripts exec tsx src/pause.ts <slug> --reason "incident <date>"
#    No terminal? https://<platform>/guardian → the kami → Pause.
#    Every kami at once? Run the line above for each slug. There is no fleet pause.
```

Pausing stops chat, cron and proposals within 60 seconds. Nothing about it is hard to undo:
**two** guardians can resume, so a pause you did not need costs a conversation, not a rebuild.

Then, in this order.

## 2. Say what you see, once, in the stewards' channel

One message: what you noticed, what time, what you paused, and that you are working it. Start a
timestamped scratch log — you will need it for the public note in step 7 and you will not remember.

## 3. Decide which of four things this is

| It looks like | Go to |
|---|---|
| The kami said something wrong, harmful, or invented | §4 **bad output** |
| Money moved, or nearly moved, that should not have | §5 **money** |
| The box, a key, or a token may be in someone else's hands | §6 **compromise** |
| It is down, not wrong | Not an incident. `docs/runbooks/box.md`. Unpause when it is back. |

Unsure? Treat it as §6. Isolating the box costs an afternoon; not isolating it costs everything.

## 4. Bad output

```bash
# What it actually said and what it was told, for the last hour.
docker compose -f infra/box/docker-compose.yml logs --since 1h gate | grep -i guard_event
```

1. Find the reply. `chat_messages` in Neon, or the gate's `guard_events.jsonl` on the box.
2. **Was it a guard failure or a guard bypass?** A number that never came from a tool result and
   was published anyway is a guard bug and blocks a phase gate (G1). A wrong-but-sourced number is
   a twin data problem — file it there.
3. If it is published prose (a pulse, a memo, a commons note), **correct it in place with the
   correction visible.** Never quietly delete.
4. If it is a persona or safety failure, add the exact turn to `evals/probes/safety.jsonl` before
   you fix anything. The regression test comes first.
5. Resume only after the eval suite passes: `uv run --package kami-evals python -m kami_evals.replay --ci`.

## 5. Money

```bash
pnpm --filter @kami/chain chain addresses          # confirm which chain you are even on
```

1. **Check the threshold held.** The Safe is 2-of-3 and the agent's key is a proposer, not an
   owner. If value moved with fewer than two human signatures, that is a protocol failure — stop
   and escalate to counsel immediately.
2. **Rotate the proposer key** (see §6.2). A proposer key can only create pending transactions, so
   a leaked one is noise, not loss — but it is still a rotation.
3. **A suspect signer:** the two remaining owners execute `swapOwner` to a fresh guardian wallet.
   **If two of the three owners are suspect, the third executes nothing.** The funds are safe
   behind the threshold. Escalate to counsel and stop touching it.
4. Reject every pending proposal you did not expect, in Safe{Wallet}, before anything else.
5. Run the reconciliation and read every finding: `curl -H "Authorization: Bearer $CRON_SECRET"
   https://<platform>/api/cron/reconcile` — then `docs/runbooks/reconciliation.md`.

## 6. Compromise — the box, a key, a token

Work top to bottom. Each step is independent; do not stop halfway.

### 6.1 Isolate the box

```bash
# Revoke the tunnel first: it is the only way in.
cloudflared tunnel token --revoke <tunnel-id>     # or: tailscale logout   on the box
```

Then revoke every per-entity `PLATFORM_MCP_TOKEN` in `/admin`, and rotate the Hermes
`API_SERVER_KEY` in both the box `.env` and Vercel. **The box holds no chain key** — that is the
design — so what an attacker gained is the ability to draft text and read the public twin. Redeploy
profiles from the repo rather than trusting what is on disk:

```bash
pnpm --filter @kami/profile-scripts run deploy-profile <slug>
```

### 6.2 Rotate the proposer key

The signing service mints a new key; a guardian signs the delegate change; the old delegate is
removed. Both writes land in `entity_events`.

```bash
pnpm --filter @kami/chain chain add-delegate --entity <slug> --safe 0x… \
  --delegate <new> --label "kami proposer" --key-env GUARDIAN_KEY
```

### 6.3 Revoke the attester

If the attester key is compromised, revoke every EAS attestation it made **after the incident
time** — every schema is registered `revocable: true` for exactly this. Then let the nightly
reconciliation recompute reputation without them, and check that it did:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<platform>/api/cron/reputation
```

### 6.4 Everything else in the inventory

`docs/security/threat-model.md` has the table: what each secret is, where it lives, and how it
rotates. On an incident, **all of them** rotate.

## 7. Publish within 72 hours

A note on the "How I work" page: what happened, what was affected, what changed, and what was
rotated. Names of attackers, no. Names of the things we got wrong, yes.

This is a product promise, not a nicety. It is in `docs/how-i-work.md` and it is the thing that
makes the pause button believable.

## 8. Resume

Two distinct guardians, within 24 hours of each other:

```bash
pnpm --filter @kami/profile-scripts exec tsx src/pause.ts <slug> --resume --guardians alice,bob
```

Then confirm it really is back: `hermes cron doctor` on the box, one chat turn on the page, and one
`/api/cron/needs` run. Write the incident up in `docs/drills/` if it taught you something a drill
should test.
