# Pause drills

A guardian pause must stop chat, cron and proposals **within 60 seconds** (T1.11, architecture
§5.9). A switch nobody has pulled is not a switch, so it gets pulled on a schedule and the result
is published — the drill log renders on every kami's "How I work" page, next to the claim it
tests.

```bash
pnpm --filter @kami/profile-scripts run pause-drill <slug> --operator <your name>
```

## What the script does

`profiles/scripts/src/pause-drill.ts`, in order:

1. Runs `pause.ts` for the slug — the same path a guardian's button takes.
2. Polls `POST <gate>/p/<slug>/v1/chat/completions` until it answers **423**, timing it in
   milliseconds.
3. If `PLATFORM_URL` is set, polls `POST <platform>/e/<slug>/chat` the same way.
4. Writes `docs/drills/<YYYY-MM-DD>.md` in the format below and prints it.
5. Resumes **only** if two guardians are named with `--resume-guardians a,b`. Otherwise it leaves
   the kami paused — which is correct: resuming takes two people, and a drill does not get to
   bypass that.
6. Exits 0 if the gate answered 423 within 60 000 ms, 1 otherwise.

```bash
# Full form.
pnpm --filter @kami/profile-scripts run pause-drill boulder-creek \
  --gate-url http://127.0.0.1:8001 \
  --timeout-s 90 \
  --operator ada \
  --resume-guardians ada,grace
```

`--out <dir>` writes elsewhere; the default is this directory. `GATE_URL` and `PLATFORM_URL` can
be set in the environment instead of passed.

## When to run one

- **Quarterly**, per kami. Put it in a calendar; it is the whole point.
- **Before a phase gate.** The phase-1 review has the owner and two guardians run one together.
- **After anything that touches the pause path** — the gate's admin route, the platform's pause
  action, `deploy-profile`, the profile templates.
- **After an incident**, to confirm the switch still works on the rebuilt machine.

Run it against staging first if you have never run it. Against production it really does pause a
live kami, and two people have to agree to wake it.

## Where the logs go

`docs/drills/<YYYY-MM-DD>.md`, one file per drill, committed. They are **public**: the "How I work"
page lists them, and `pause_events` carries the same actions in the database with the hash-chained
audit trail.

**A second drill on the same day overwrites the first**: the script names the file from the date
alone. If you re-drill after a failure, pass `--out` and rename the file (`2026-09-12b.md`) before
the second run, or copy the first log aside — the failure is the one worth keeping.

Never edit a drill log after the fact. A failed drill is more useful published than a passed one is
— it is the only evidence anyone has that the number in the claim is real. If a drill fails, file
the fix, run another, and leave both logs in place.

## What "PASS" means, and what it does not

**PASS:** the gate refused a completion within 60 seconds of the pause. That is the SLA and it is
what the script measures.

**It does not measure**, and you have to check by hand, once:

- **Hermes cron jobs stopped.** `hermes cron list --profile <slug>` on the box — the drill log
  prints this as a manual step, and the exact command is still one of the unconfirmed Hermes items
  in `docs/verify.md` row 1.
- **The profile file was updated.** `profiles/<slug>/state/paused` exists, so the next deploy
  writes `paused: true` and a gateway restart cannot resurrect it.
- **Resume needs two.** Try resuming with one name; it must refuse.

Write anything you checked into the log's Notes.

---

## Worked example

`docs/drills/2026-09-12.md` — what a good one looks like:

```markdown
# Pause drill — 2026-09-12

A guardian pause must stop chat, cron and proposals within 60 s. This log is public on "how I work".

- Entity: `boulder-creek`
- Started (UTC): 2026-09-12T16:04:11.482Z
- Initiated by: ada
- Gate returned 423 after: 2140 ms (target ≤ 60000 ms)
- Platform chat route returned 423 after: 2680 ms
- Hermes jobs paused: verify by hand — `hermes cron list --profile boulder-creek` (*verify* the command)
- Resumed: by ada and grace (two guardians)
- Result: **PASS**
- Notes:
  - pause.ts returned after 610 ms; gate 423 observed 2140 ms later
  - checked by hand: `hermes cron list --profile boulder-creek` shows all five jobs disabled
  - checked by hand: `profiles/boulder-creek/state/paused` was created
  - checked by hand: resume with one guardian was refused; two succeeded
  - the page rendered "paused by my guardians" within one poll (60 s) and the composer was disabled
```

A failing one is written the same way and kept the same way:

```markdown
- Gate returned 423 after: no 423 within 90 s
- Result: **FAIL**
- Notes:
  - the gate could not reach the platform's pause set and was failing closed on *completions* but
    still answering 200 on the health path; the pause never propagated
  - cause: GATE_PLATFORM_TOKEN expired 2026-09-10
  - fix: rotated the token, redeployed the gate; re-drilled the same day — see 2026-09-12b.md
```

Two things that example does right: it names the cause rather than "transient issue", and it links
the re-drill instead of overwriting the failure.
