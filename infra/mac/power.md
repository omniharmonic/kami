# Keeping the Mac awake — the settings that stop it sleeping through its own cron

A kami's hourly pulse is a job inside Hermes, not a macOS scheduled task. macOS will not wake
the machine for it. If the Mac sleeps, the pulse simply does not run, nothing errors, and the
first sign is a `status.json` whose `as_of` quietly stops moving. Nothing is queued for
replay in v1 — a missed pulse is missed — so the fix is to not sleep at all.

**Everything on this page is *verify*** (docs/verify.md #78): it was written against Apple's
`pmset` documentation and cannot be tested from the repository's sandbox, which is Linux. Run
each command, then run `pmset -g custom` and read back what actually took effect; a flag your
Mac does not support is silently ignored by `pmset -a`.

## The settings

```bash
sudo pmset -a sleep 0          # never put the system to sleep. The one that matters.
sudo pmset -a disksleep 0      # do not spin down storage under a running service
sudo pmset -a displaysleep 10  # the display may sleep; that is not system sleep
sudo pmset -a womp 1           # wake for network access
sudo pmset -a autorestart 1    # restart automatically after a power failure
sudo pmset -a powernap 0       # no half-awake background maintenance windows
sudo pmset -a standby 0        # no deep sleep to disk
sudo pmset -a hibernatemode 0  # desktop default; keeps state in RAM, never hibernates
sudo pmset -a tcpkeepalive 1   # Apple silicon: keep TCP alive rather than dropping the tunnel
```

Then confirm — this is the part people skip:

```bash
pmset -g custom                # what is actually set, per power source
pmset -g assertions            # what is currently preventing (or allowing) sleep
pmset -g log | grep -iE 'sleep|wake' | tail -20    # did it sleep overnight?
```

The GUI equivalents, if you prefer: System Settings → Energy →
"Prevent automatic sleeping when the display is off", "Wake for network access",
"Start up automatically after a power failure".

`caffeinate -dimsu` is a belt-and-braces you can run in a terminal while you are watching
something, but it is not the fix: it dies with its session, and the machine sleeps again.

## The thing that will actually catch you out: login

Both Kami agents are **LaunchAgents**, which run in your login session (`gui/$(id -u)`). They
do not start at boot; they start when you log in. So after a power cut the Mac restarts
(because `autorestart 1`), sits at the login window, and the kami stays silent until someone
types a password.

Three ways out, and they are a real trade-off:

1. **Automatic login** (System Settings → Users & Groups → Automatically log in as). Simple,
   and it makes the reboot path work end to end. It requires **FileVault to be off**: with
   FileVault on, the Mac stops at the unlock screen before any login happens, and automatic
   login is not offered at all. Turning FileVault off means `~/.kami/kami.env` — the API key,
   the gate secret, the entity token — sits on an unencrypted disk. On a machine at home
   whose only secrets are rotatable service credentials, that is a defensible choice, but
   make it deliberately: if the Mac is stolen, rotate every key in that file (`docs/security/`
   and the incident playbook cover the rotation order).
2. **Keep FileVault and accept manual intervention.** For planned reboots,
   `sudo fdesetup authrestart` unlocks the disk once on the next boot, so a software update
   is fine. An unplanned power cut is not: the machine waits for a human. If you take this
   route, say so in the entity's "how I work" page — the site already renders "I'm asleep"
   honestly, so the outage is visible, but the reason should not be a mystery.
3. **Convert the agents to LaunchDaemons** (`/Library/LaunchDaemons`, owned by root). They
   then start at boot with no login. The cost is that `~/.hermes` (profiles, cron state,
   memory) and `~/.kami/kami.env` are user paths: you would have to move them somewhere a
   daemon user can read, and set `UserName` in the plist. Worth doing when this stops being a
   one-person setup; not worth it on day one, which is why `install.sh` does not.

Whichever you pick, the honest test is a real one:

```bash
sudo shutdown -r now      # and then, without touching the keyboard:
bash scripts/kami-doctor  # from another machine, or after it comes back
```

## Two more things that will restart the Mac without asking

* **Automatic macOS updates.** They reboot, and with automatic login the agents come back —
  but Hermes and the gate will be down for the duration and a pulse or two will be missed.
  Either accept that, or set updates to notify only (System Settings → General → Software
  Update → Automatic Updates), and take them in a window you choose.
* **Screen sharing / remote login.** Turn on Remote Login (`sudo systemsetup -setremotelogin on`)
  before you need it, so a headless Mac in a cupboard is reachable when something goes wrong.

## How you will know it slept anyway

`kami doctor` will not tell you the Mac slept — it tells you the consequences, which is the
honest order to notice them in:

* `platform.status_json` — `as_of` older than two hours;
* `hermes.cron_doctor` — a failure streak;
* `tunnel.external` — the tunnel dropped and reconnected (Cloudflare handles this, but a
  sleep long enough to drop it shows up in the log).

`pmset -g log | grep -i 'Entering Sleep'` is where the answer actually is.
