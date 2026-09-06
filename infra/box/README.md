# infra/box — the GPU box runbook

Architecture §12.3–§12.5, §5.7, §10.2–§10.3; plan T0.2, T0.3, T3.2. One box runs vLLM, the entity-gate,
the Hermes gateway (multiplexed profiles), a tunnel client, and an OTel collector — all in
`docker-compose.yml`, every published port loopback-only, **no chain key anywhere on the machine**.

```
infra/box/
├── docker-compose.yml     vllm · gate · hermes · tunnel (cloudflared active / tailscale commented) · otel
├── hermes.Dockerfile      FROM the official Hermes image at HERMES_IMAGE_TAG (default v0.21.0, *verify*) + uv + Node 22
├── hermes.config.yaml     global Hermes config: gateway.multiplex_profiles: true (*verify* key paths)
├── otel-collector.yaml    OTLP in, vLLM Prometheus scrape, debug exporter to stdout
├── gate.yaml.example      the gate's schema: upstream_url, listen, passthrough, budgets, concurrency, paused, platform, events_dir
├── .env.example           every variable compose reads; no secrets
├── firewall.sh            nftables default-deny inbound; lo + established + tailscale0; SSH only via Tailscale
├── smoke.sh               guard probe · 64k-context probe · tool-call probe (vllm#42021) · one pulse
├── backup.sh              nightly encrypted (age/gpg) tar of ~/.hermes → R2
└── tests/test_no_chain_keys.sh   X.1 grep over profiles/ and infra/box/
```

## 0. Provision and harden (once)

1. Rent the card — Hetzner GEX44 (20 GB) for 9B, GEX131 (96 GB) for 27B — or rack an owned RTX 4090
   (owner decision, PRD §11 #3; prices *verify*, docs/verify.md #19). Ubuntu LTS, NVIDIA driver, Docker with
   the NVIDIA container toolkit.
2. `tailscale up --ssh` on the **host** (this is how you and `deploy-profile.ts` reach the box).
3. `sudo ./firewall.sh` — then from outside the tailnet `nmap -Pn <public ip>` must show every port
   filtered (T0.2 done-when). Re-run after any Docker upgrade; Docker's own chains do not open anything because
   nothing is published beyond 127.0.0.1.
4. Create the `hermes` user, `~/.hermes/profiles/`, `/opt/models`, and `/opt/kami` (a checkout of this repo;
   compose builds the gate from `../../apps/gate` and mounts `../../packages/treasury-mcp`).
5. `cp .env.example .env && chmod 600 .env`; fill the secrets. `cp gate.yaml.example gate.yaml`; set
   `platform.pause_set_url`.

## 1. Start vLLM (§12.5 step 1)

`docker compose up -d vllm`. The command is the §12.5 flag set for `Qwen/Qwen3.5-9B`:

```
--max-model-len 65536 --enable-auto-tool-choice --tool-call-parser hermes --reasoning-parser qwen3
--enable-prefix-caching --max-num-seqs ${VLLM_MAX_NUM_SEQS}
```

First start pulls ~18 GB of weights into `/opt/models` (set `HF_HUB_OFFLINE=1` afterwards). Wait for
`docker compose logs -f vllm` to print the Uvicorn ready line, then `curl -s 127.0.0.1:8000/v1/models`.
Hermes refuses models under a 64k context (ADR-E03), so `--max-model-len` is not negotiable; if the KV
cache does not fit, lower `--max-num-seqs`, not the context.

### The vllm#42021 check (T0.2 step 4) — record the answer here

Send a request with `chat_template_kwargs: {enable_thinking: true}` **and** a tool schema (that is exactly
`smoke.sh` probe 3). Fill the table; if `<tool_call>` does not parse with the reasoning parser on, run without
`--reasoning-parser qwen3`, re-test, and note it — the profiles do not depend on visible reasoning.

| Date | vLLM tag | Model | `--reasoning-parser qwen3` | `enable_thinking` | `tool_calls` parsed? | `reasoning_content` present? | tokens/s @8k prompt | tokens/s @60k prompt | KV budget @ `--max-num-seqs` | Decision |
|---|---|---|---|---|---|---|---|---|---|---|
| | | Qwen/Qwen3.5-9B | on | true | | | | | 8 → | |
| | | Qwen/Qwen3.5-9B | off | true | | | | | | |
| | | Qwen/Qwen3.8-27B | on | true | | | | | | |

## 2. Start the gate (§12.5 step 2)

`docker compose up -d gate`. It reads `gate.yaml`, pulls the pause set and budgets from the platform every
30 s, and **fails closed** (refuses completions) when it cannot. `curl -s 127.0.0.1:8001/healthz`. Per-entity
budgets default to 800k prompt / 40k output tokens per day with a separate cron budget (§5.7, T3.3).

## 3. Start Hermes (§12.5 step 3)

`docker compose build hermes && docker compose up -d hermes`. Host network; the API server binds
`127.0.0.1:8642` with `API_SERVER_KEY`; `gateway.multiplex_profiles: true` from `hermes.config.yaml`.
`curl -s -H "Authorization: Bearer $API_SERVER_KEY" 127.0.0.1:8642/v1/models`.

### The five T0.3 Hermes questions — write the answers down (docs/verify.md #1–2)

| # | Question | Answer | Checked on | Source |
|---|---|---|---|---|
| a | Per-profile API routing in multiplexed mode: does `POST /p/<profile>/v1/chat/completions` reach that profile? If not, one API port per profile. | | | |
| b | Exact `agent.disabled_toolsets` names — including `delegate` — on v0.21.0 | | | |
| c | Cron pause via REST: `POST /api/jobs/pause {profile}` (or the real path/verb) | | | |
| d | Profile reload without a gateway restart: `hermes profile reload <slug>` / `POST /api/profiles/<slug>/reload` | | | |
| e | Does the API response expose the tool-call log (for the "what I looked at" footer)? Fallback: the gate's own log keyed by request id | | | |

Also confirm: the exact image name/tag for v0.21.0 (`v0.21.0` vs `v2026.8.31`); `hermes cron add` flag
names as mapped in `profiles/templates/cron.yaml`; whether `cron.max_parallel_jobs` spans profiles; whether
a `paused:` key in a profile config is honoured; the container's unprivileged username.
**Done when:** `hermes cron doctor` runs clean on an empty profile and the five answers are written down.

## 4. Start the tunnel (§12.5 step 4)

`docker compose up -d tunnel`. cloudflared is the active block: route `gw.<host>` → `http://127.0.0.1:8642`
in the dashboard, protected by a Cloudflare Access service token that only the Vercel origin holds. The
Tailscale block is kept commented for the alternative (tailnet-only API server with an ACL for the Vercel
egress node). Which one fits the owner's existing twin tunnel is *verify* (docs/verify.md #16). Either way the
tunnel exposes **only** 8642 — never 8000 or 8001.

## 5. Smoke (§12.5 step 5)

```bash
./smoke.sh            # or SKIP_PULSE=1 ./smoke.sh before any profile is deployed
```

1. **Guard:** a fabricated `get_entity_status` tool result (15.4 cfs) and a reply forced to include "30% below
   normal" → the 30% sentence is gone and the gate line `I dropped a sentence because it contained something I
   hadn't measured.` is present.
2. **64k context:** a ~60k-token prompt to vLLM returns 200 and text.
3. **Tool call:** a tool schema with thinking on returns a parsed `tool_calls[0].function.name == get_entity_status`.
4. **Pulse:** `hermes cron run pulse --profile boulder-creek` prints a `wakeAgent` decision (*verify* subcommand).

Run it twice after a reboot (T0.2 done-when).

## 6. Model update (§12.5 step 6)

Pull the new weights to a second directory under `/opt/models`; start a second vLLM on port 8002 (copy the
service, change the port and `--model`); run the eval suite (`evals/`, hallucination probe ≥ 95 %) against it;
swap `VLLM_MODEL` in `.env` and `docker compose up -d vllm` during the nightly window; keep the previous
weights for rollback. Swapping 9B → 27B is the same procedure plus `--tool-call-parser qwen3_coder` (ADR-E03,
*verify*) and a `--large-model qwen3.8-27b` re-deploy of every profile so weekly/quarterly jobs pin it.

## 7. Profile deploy (§12.5 step 7)

From a machine on the tailnet:

```bash
PLATFORM_MCP_TOKEN=… BOX_HOST=box PLATFORM_URL=https://<platform> \
  pnpm --filter @kami/profile-scripts run deploy-profile boulder-creek
```

Then on the box: `hermes cron doctor`; check the pulse skipped/woke counter within the hour. Staging previews
use `--staging` (profile `boulder-creek-staging`, its own gate budget in `gate.yaml`). See `profiles/README.md`.

## Pause and resume (§5.9)

`pause.ts <slug>` hits `POST /admin/pause/<slug>` on the gate (X-Gate-Admin), the platform's pause action,
prints the Hermes `/api/jobs` call, and leaves a `state/paused` marker so the next deploy writes `paused:
true`. One guardian pauses; resuming needs two distinct names. Drill quarterly with `pause-drill.ts`; the log
goes to `docs/drills/<date>.md` and is public on "how I work".

## Backup (§12.4)

`backup.sh` tars `~/.hermes` nightly, encrypts it with `age -r $BACKUP_AGE_RECIPIENT` (the private key stays
with the operator; `gpg` is the fallback), uploads to R2 (`s3://kami-data/backups/hermes/`, 90-day lifecycle)
and keeps three local copies. It refuses to run if anything chain-key-shaped is inside the profiles. Cron:
`15 3 * * * /opt/kami/infra/box/backup.sh`. Restore: `age -d`, `zstd -d`, untar into `~/.hermes`, redeploy
profiles from the repo (they are regenerable at any commit, §12.7). Rehearse before phase 2.

## Capacity defaults (§5.7)

| Card | Model | Entities | Notes |
|---|---|---|---|
| 20–24 GB (GEX44, RTX 4090) | Qwen3.5-9B | **10** | `--max-num-seqs 8`; ~20–25 GPU-min/entity-day on 27B, 3–4× fewer on 9B |
| 48 GB | Qwen3.5-9B | **20** | raise `--max-num-seqs` with the KV budget measured in the vllm#42021 table |
| 96 GB (GEX131) | Qwen3.8-27B | ~20 | 64k contexts need 32–48 GB for 27B; the KV cache is the binding constraint |

Over budget → 429 → the web app renders "I've talked a lot today; back tomorrow". Box down → the site keeps
serving `status.json`; chat renders "I'm asleep — my thinking machine is off"; nothing is queued for replay in v1.

## Secrets on this box (§10.2)

`API_SERVER_KEY` (also in Vercel), `GATE_ADMIN_SECRET`, `GATE_PLATFORM_TOKEN`, the tunnel token, one
`PLATFORM_MCP_TOKEN` per profile `.env`, the backup recipient **public** key, R2 keys for the backup prefix.
Nothing else. `tests/test_no_chain_keys.sh` runs in CI over `profiles/` and `infra/box/`; `backup.sh` runs the
same grep over the live profiles before every archive. Revoking the tunnel token and the entity tokens isolates
the box (§10.6 step 4); the twin is read-only anyway.

## Observability (§5.8)

The gate exports OTLP to `otel:4318`; the collector redacts `gen_ai.prompt` / `gen_ai.completion` attributes
and logs spans to stdout (`docker compose logs otel`); it also scrapes vLLM's `/metrics`. `hermes cron doctor`
output is scraped into the platform healthcheck; `failure_streak ≥ 3` pages a steward.
