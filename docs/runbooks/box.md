# Runbook — the GPU box when it misbehaves

```bash
ssh box && docker compose -f /opt/kami/infra/box/docker-compose.yml ps
```

**`infra/box/README.md` is the box's manual** — provisioning, the firewall, starting vLLM, the
gate, Hermes and the tunnel, the smoke test, capacity numbers, the secrets that live there. Read it
for anything routine. This file covers only the three ways the box goes wrong at an inconvenient
hour, none of which are in there.

**Before you start:** the site does not need this machine. Pages render from `status.json` and the
chat says "I'm asleep — my thinking machine is off" (ADR-E14). You are restoring the voice, not the
service. Take the time to do it right.

---

## The tunnel dropped

*Symptom:* chat renders asleep, `/admin` shows the tunnel last seen minutes ago, the box itself is
fine.

```bash
docker compose -f /opt/kami/infra/box/docker-compose.yml logs --tail 100 tunnel
```

1. **Restart it first, diagnose after.** `docker compose up -d --force-recreate tunnel`. Wait 60
   seconds; `/admin` should show a fresh heartbeat.
2. **Still down — is it the credential or the network?**
   `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $API_SERVER_KEY" http://127.0.0.1:8642/api/health`
   from the box. 200 means Hermes is fine and the problem is between the tunnel and the internet.
3. **Credential expired or revoked:** mint a new one, put it in `infra/box/.env`, recreate the
   container. Check nobody revoked it on purpose — a revoked tunnel is step 4 of the incident
   playbook, so ask in the stewards' channel before you re-establish it.
4. **The tunnel provider is having an outage:** switch to the standby. The Tailscale block in
   `docker-compose.yml` is kept commented for this. Uncomment it, comment cloudflared, recreate,
   and add the Vercel egress node to the ACL.
5. **Never widen the exposure while fixing it.** The tunnel exposes `127.0.0.1:8642` and nothing
   else. Not 8000. Not 8001. If you are tempted to open a port to test something, use an SSH
   tunnel over Tailscale instead.
6. When it is back: one chat turn on the page, and `hermes cron doctor` to see whether jobs backed
   up. Nothing is queued for replay in v1 — the missed pulses are simply missed, and that is
   correct behaviour, not a bug to fix at 3 a.m.

## vLLM ran out of memory

*Symptom:* `CUDA out of memory` in the vLLM logs; the gate returns 5xx or times out; chat is asleep
or very slow.

```bash
docker compose -f /opt/kami/infra/box/docker-compose.yml logs --tail 200 vllm | grep -i "out of memory\|CUDA"
nvidia-smi
```

1. **Lower concurrency, never the context.** Hermes refuses models under a 64k context (ADR-E03),
   so `--max-model-len 65536` is not negotiable. The knob is `VLLM_MAX_NUM_SEQS` in
   `infra/box/.env`: halve it and recreate the vllm service.
2. **Check what else is on the card.** A second vLLM left running from a model-update rehearsal
   (port 8002) is the usual culprit. `nvidia-smi` shows it; stop it.
3. **If it OOMs at rest**, with no traffic, the KV budget for that model on that card is simply too
   large. Record the numbers in the vllm#42021 table in `infra/box/README.md` — that table exists
   to stop the next person rediscovering this — and either lower `--max-num-seqs` further or move
   to a larger card.
4. **Fewer entities per card** is the last resort and the honest one. The capacity table in
   `infra/box/README.md` says 10 entities on a 20–24 GB card with `--max-num-seqs 8`. If you are
   past that, the answer is another card, not a cleverer flag.
5. Confirm recovery with the smoke test, which exercises the 64k path deliberately:
   `SKIP_PULSE=1 ./smoke.sh`.

## The card is unavailable — gone, failing, or repossessed

*Symptom:* `nvidia-smi` errors, the host is up but the GPU is not, or the rental provider has taken
it back.

1. **Say so, in public, before you fix it.** `/admin` shows the tunnel down and the pages render
   asleep by themselves, which is honest but silent. Post a line on the "How I work" page if it
   will be more than a few hours.
2. **Do not pause the entities.** Pausing is the guardians' switch and it needs two of them to
   undo. A missing card is an outage, and the software already renders an outage correctly.
3. **Do not point the gate at a hosted frontier model to keep the lights on.** No cloud frontier
   model on the hot path is a product rule (PRD non-goals), and quietly breaking it during an
   outage is exactly how it gets broken permanently.
4. **Bring up a replacement:** any machine with the same weights and the §12.5 flag set. The
   architecture treats the model as a URL. In order: rent a pod by the hour; or start the gate in
   `--passthrough` mode against a smaller local model for chat only, with the cron jobs left off;
   or leave it asleep. All three are acceptable; the third is not a failure.
5. **On the replacement, before any traffic:** `./firewall.sh`, then confirm from outside the
   tailnet that `nmap -Pn <ip>` shows every port filtered. A hurried replacement box with an open
   port is a worse incident than the outage.
6. **Check the profiles came back clean:** the deploy is idempotent and regenerable from the
   repository at any commit, so redeploy rather than copying `~/.hermes` from anywhere.
   `bash infra/box/tests/test_no_chain_keys.sh` before you consider it done.
7. When the card returns, cut back during the nightly window, keep the previous weights, and run
   `./smoke.sh` twice — once cold, once after a reboot.
