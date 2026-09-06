# Threat model

Architecture §10, expanded: for every threat, what is **implemented today**, what is **deferred**,
and where the code is. Nothing here is aspirational — a control listed as implemented has code
behind it and, where it is testable, a test. A control that is deferred says so and says until
when.

**Reviewed:** 2026-09-06, at the end of the first build round. **Re-read before every phase gate**
(X.1) and after any incident.

Legend: **✅ implemented** · **◐ partial** — the mechanism exists, something named is missing ·
**⏳ deferred** — a decision, with a phase · **👤 human** — a procedure, not code.

---

## 1. Threats and controls

### Prompt injection into the entity
*Vectors: commons notes, evidence text, human bounty proposals, chat.*

| Control | State | Where |
|---|---|---|
| Evidence reaches the model only as a structured summary — counts and a ≤ 500-character note with links stripped; never the image, never free text | ✅ | `apps/web/src/lib/evidence/summary.ts` |
| Commons prose is quoted as data, never as instruction; the SOUL says tool text is data | ✅ | `profiles/templates/SOUL.hard-rules.md`, `apps/web/src/lib/commons/` |
| Traditional-Knowledge-labelled commons material is never read to the model | ✅ | `apps/web/src/lib/commons/tk-safe.ts` |
| The model has no tool that moves value or messages a third party | ✅ | `packages/treasury-mcp` — three tools, no signer; `apps/web/src/lib/mcp/tools.ts` |
| The guard drops uttered facts that did not come from this turn's tools | ✅ | `packages/factguard`, `apps/gate/src/entity_gate/guard_hook.py` |
| A dedicated injection classifier on tool output | ⏳ phase 3 | with the safety classifier below |

**Honest gap:** the guard constrains *facts*, not *instructions*. A note that persuades the model
to adopt a persona, refuse, or write something tonally wrong passes the guard untouched. What
catches that today is the SOUL's hard rules, the persona eval, and a human reading the output — not
a control.

### Rogue spend
*Vectors: the agent, a bug, an injection.*

| Control | State | Where |
|---|---|---|
| The agent is a Transaction-Service **proposer** delegate, never a Safe owner | ✅ | `infra/chain/src/deploy-safe.ts`, `add-delegate` |
| Safe 2-of-3; the deployer is asserted not to be an owner, before and after deployment | ✅ | `infra/chain` — `assertOwnersValid` |
| The treasury MCP has exactly three tools and no signing dependency | ✅ | `packages/treasury-mcp`; enforced by `scripts/checks/treasury-mcp-keyless.mjs` |
| The signing service validates every proposal against evaluation state and caps | ✅ | `apps/web/src/lib/signing/validate.ts` |
| `executeWithRelayer` refuses below the threshold | ✅ | `infra/chain/src/safe-tx.ts` |
| Zodiac Roles allowance ≤ 25 USDC per transfer, 100 USDC/24 h, fixed recipient set | ⏳ phase 3 | `infra/chain/src/enable-roles.ts` exists and **proposes only**; not enabled |

### Key theft — proposer, attester, relayer
| Control | State | Where |
|---|---|---|
| Keys in KMS or a server-wallet provider; never on the box, never in a profile, never in the repo | ✅ | `apps/web/src/lib/signing/kms.ts`; enforced by `scripts/security-check.sh` |
| The proposer can only create pending transactions | ✅ | delegate, not owner |
| The attester can only attest, and every schema is `revocable: true` | ✅ | `infra/chain/src/eas.ts` |
| Relayer float cap | ◐ | the cap is a configuration value; **no automated alarm when it is approached** |
| Rotation runbook | ✅ | `docs/runbooks/chain.md` |
| Rotation actually performed on schedule | 👤 | proposer quarterly, others annually — nothing enforces the calendar |

### Guardian key theft
*Vectors: phishing, account takeover of an embedded wallet.*

| Control | State | Where |
|---|---|---|
| Threshold 2 — one compromised guardian cannot move anything | ✅ | Safe config |
| Pending proposals are visible to every guardian | ✅ | `/guardian/proposals` |
| **Any one guardian can pause**, and pausing needs no quorum | ✅ | ADR-E12; `apps/web/src/lib/governance/pause.ts` |
| A hardware key for at least one owner | 👤 | recommended, not enforceable in software |

### Sybil and bounty fraud
| Control | State | Where |
|---|---|---|
| Verification tiers keyed to what the twin can measure | ✅ | `apps/web/src/lib/evidence/spec.ts` |
| EXIF and GPS checked against the spec's radius | ✅ | `apps/web/src/lib/evidence/{exif,gps}.ts` |
| Evaluator ≠ claimant ≠ proposer, enforced in the database | ✅ | migration `0001_evaluator_independence.sql` |
| Second attestation above the threshold | ✅ | `apps/web/src/lib/governance/evaluations.ts` |
| Per-person monthly cap across all kami | ✅ | `apps/web/src/lib/governance/claims.ts` |
| Human Passport gate above a threshold | ✅ | `apps/web/src/lib/governance/claims.ts` reads `users.passport_score`; `apps/web/src/lib/passport/refresh.ts` + `/api/cron/passport` populate it |
| 10 % random second-evaluator audits | ◐ | audits are supported; the random selection is manual |
| Deferred tier-4 payouts | ✅ | tracked in `config.tier4_followups` — see `docs/schema-gaps.md` #3 |

### Donor manipulation
| Control | State | Where |
|---|---|---|
| Donation pages are static copy, never generated | ✅ | `apps/web/src/copy/index.ts`, `Treasury.tsx` |
| Every ask lists what money cannot do | ✅ | `treasury.moneyCannotDo` |
| No recurring default, no countdown | ✅ | "One-time only. Nothing recurs unless you come back." |
| Urgency language forbidden, and tested | ✅ | `forbiddenUrgency` + `e2e/tests/no-token.spec.ts` |
| The guard blocks invented numbers in donor reports | ✅ | held for review on a second failure (ADR-E04) |

### Jailbreaks — making the river say things
| Control | State | Where |
|---|---|---|
| Hard rules first in the SOUL, byte-identical across the fleet | ✅ | `profiles/templates/SOUL.hard-rules.md` |
| Crisis detection replaces the reply with resources, logged, never generated | ✅ | `apps/gate/src/entity_gate/crisis.py` |
| Session rate limits — 20 turns/hour/session, 60/day/IP | ✅ | `apps/web/src/lib/ratelimit.ts` |
| Every reply logged for 90 days | ✅ | `chat_messages` + retention |
| A safety classifier on input and output | ⏳ phase 3 | T3.9; blocked categories are §10.4 |

**Honest gap:** between the SOUL and the phase-3 classifier there is nothing but the persona eval.
The guard is not a safety filter and was never meant to be.

### GPU box compromise
| Control | State | Where |
|---|---|---|
| **No chain key on the box**, ever — a grep test in CI | ✅ | `infra/box/tests/test_no_chain_keys.sh`, run by `scripts/security-check.sh` |
| Outbound-only: default-deny firewall, every service bound to `127.0.0.1` | ✅ | `infra/box/firewall.sh`, `docker-compose.yml` |
| The tunnel exposes only the Hermes API path — never 8000, never 8001 | ✅ | `infra/box/docker-compose.yml` |
| The per-entity platform token is scoped to that entity's tools | ✅ | `apps/web/src/lib/mcp/tokens.ts` |
| Revoking the tunnel credential isolates the box | ✅ | `docs/runbooks/incident.md` §6.1 |
| The twin is read-only from here in any case | ✅ | ADR-E01 |

### Twin outage or bad data
| Control | State | Where |
|---|---|---|
| Stale is a first-class state everywhere; nothing is interpolated | ✅ | ADR-E11; `packages/needs`; `e2e/tests/stale.spec.ts` |
| `get_health` verdicts surfaced on the page | ✅ | source status per meter |
| Pulses skip on unchanged or absent data | ✅ | `profiles/templates/skills/entity-steward/scripts/pulse_precheck.py` |
| The site renders from the last `status.json` with a visible "as of" | ✅ | ADR-E14; `e2e/tests/offline.spec.ts` |

### Minors
| Control | State | Where |
|---|---|---|
| No accounts under 13 — declared at sign-up, enforced server-side | ✅ | `apps/web/src/lib/auth.ts` |
| No direct messages; no companionship framing | ✅ | product |
| Persistent disclosure, and a reminder every N turns | ✅ | ADR-E13; `e2e/tests/disclosure.spec.ts`, `chat.spec.ts` |
| Crisis protocol routes to real resources | ✅ | `crisis.py`, `copy.crisis` |
| The statutory reminder cadence for minors | ⏳ counsel | `docs/verify.md` #38; 12 turns is a guess |

### The web app's own surface
| Control | State | Where |
|---|---|---|
| No secret in `NEXT_PUBLIC_*`, nothing credential-shaped under `public/` | ✅ | `scripts/checks/no-public-secrets.sh` |
| Webhook HMAC over `<timestamp>.<raw body>`, constant-time, 5-minute window, idempotent by event id | ✅ | `apps/web/src/app/api/webhooks/hermes/route.ts` |
| Cron routes behind `CRON_SECRET` | ✅ | `apps/web/src/lib/jobs/common.ts` |
| `entity_events` append-only, hash-chained, verified nightly | ✅ | migration `0002`, `/api/cron/verify-chain` |
| Anonymous chat cookie is HMAC-signed so sessions cannot be minted | ✅ | `apps/web/src/lib/anon.ts` |
| Stripe idempotency by event id | ✅ | `apps/web/src/lib/donations/webhook.ts` — a claimed-key table, released on failure so a retry is not swallowed |

**Open finding — rate-limit evasion.** The per-IP limit hashes the first entry of
`X-Forwarded-For`, which the client controls. Behind Vercel, which sets that header itself, this is
sound. Anywhere else — a proxy that *appends* rather than replaces, or a direct origin — a client
can rotate the header and evade the 60/day limit entirely. Either pin the trusted hop count or read
the platform's own client-IP header. Found by the e2e work package, 2026-09-06; owned by
`apps/web`.

---

## 2. Secrets inventory

Every secret, where it lives, what uses it, and how often it rotates. **No secret is ever in a
`NEXT_PUBLIC_*` variable, a commons note, a status file, or an unencrypted profile backup** —
enforced by `scripts/security-check.sh`, not only by policy.

| Secret | Lives in | Used by | Rotation |
|---|---|---|---|
| Neon connection string | Vercel env | app, cron routes | on incident |
| `BETTER_AUTH_SECRET` | Vercel env | session signing | annual / incident |
| `CHAT_COOKIE_SECRET` | Vercel env | the anonymous chat cookie, IP hashing | annual / incident |
| `RESEND_API_KEY` | Vercel env | magic links, guardian invitations | annual / incident |
| Stripe secret key + webhook secret | Vercel env | donations | annual / incident |
| Privy app secret | Vercel env | server-side verification, server wallets | annual |
| **Proposer key** (one per entity) | KMS / server wallets | the signing service | **quarterly**, and on incident |
| Attester key | KMS / server wallets | the signing service | annual / incident |
| Relayer key | KMS / server wallets | gas sponsorship | annual / incident |
| Deployer key | KMS / server wallets | chain scripts | annual / incident |
| Keeper key (phase 3) | KMS / server wallets | the Roles keeper | annual / incident |
| `PLATFORM_MCP_TOKEN` (one per entity) | the Hermes profile `.env` on the box | treasury MCP, platform MCP | **on every profile deploy**, and on incident |
| `PLATFORM_ADMIN_TOKEN` | operator machines | chain scripts writing config, pause | on incident |
| Hermes `API_SERVER_KEY` | the box and Vercel env | the chat route | **quarterly** |
| `GATE_ADMIN_SECRET` | the box, operator machines | `pause.ts` → the gate's admin route | quarterly / incident |
| `GATE_PLATFORM_TOKEN` | the box | the gate reading the pause set and budgets | on incident |
| `HERMES_WEBHOOK_SECRET` | the box and Vercel env | cron delivery signatures | annual / incident |
| `CRON_SECRET` | Vercel env | every `/api/cron/*` route | annual / incident |
| Tunnel credential | the box | cloudflared / tailscaled | **on incident** — this is the isolation switch |
| Parachute `entities` vault token | Vercel env | commons sync | ≤ 1 year TTL; revoke by `jti` |
| Twin MCP API key (optional tier) | the box | the twin MCP | issued by the twin operator |
| R2 keys | Vercel env; the box holds only the backup-prefix key | publisher, evidence, backups | annual |
| Backup **public** key (age recipient) | the box | `backup.sh` | not a secret; the private key stays with the operator, off the box |

On any incident, **every** row rotates. See `docs/runbooks/incident.md` §6.

---

## 3. Network posture

**The GPU box.** Default-deny inbound (`infra/box/firewall.sh`, nftables); no public ports; SSH
only over Tailscale. vLLM (8000), the gate (8001) and Hermes (8642) all bind `127.0.0.1`. The
tunnel exposes **only** the Hermes API server path, to the Vercel origin, behind a service token —
never 8000 and never 8001. Acceptance test: from outside the tailnet, `nmap -Pn <public ip>` shows
every port filtered. Re-run after any Docker upgrade.

**The platform.** Everything runs on Vercel's Node runtime against Neon. The only inbound paths
that are not the public site are `/api/webhooks/hermes` (HMAC), `/api/cron/*` (`CRON_SECRET`),
`/api/mcp` and `/api/entities/*` (per-entity bearer tokens), and `/api/gate/*` (a shared secret).

**The twin.** Read-only, as a browser reads it: no more than once per 60 seconds, honouring
`ETag` and `Cache-Control`, with an identifying `User-Agent`. The platform never writes into the
twin and never requests the real coordinates of a generalised place.

**Rate limits.** Chat: 20 turns per session per hour, 60 per day per anonymous IP, 200 per day
authenticated. Platform MCP: 600 requests per hour per entity token. Evidence: 50 MB per file, 30
files per submission. Gate: 2 concurrent completions per entity, queue of 8, then 429 with
`Retry-After`; a per-entity daily token budget; **fails closed** — it refuses completions when it
cannot reach the platform to read the pause set.

**Egress.** The box talks to the twin, the platform, and its own model. The platform talks to Neon,
R2, Stripe, Resend, an RPC endpoint, the Safe service and EAS. Nothing sends chat text to a
third-party model provider; there is no frontier model on the hot path.

---

## 4. What is deferred, in one list

Read this before a phase gate; it is the honest answer to "what is not protected yet".

| Deferred | Until | Consequence meanwhile |
|---|---|---|
| Safety classifier on input and output | phase 3 (T3.9) | the SOUL and the persona eval are the only guards on tone and category |
| Zodiac Roles capped allowance | phase 3 (T3.5) | every payout needs two human signatures — safer, just slower |
| Random 10 % second-evaluator audits | phase 2 | audits happen when a human orders one |
| Relayer float alarm | phase 2 | the cap exists; nothing warns as it is approached |
| Live Stripe at all | the legal checklist | test mode only; the code and its idempotency are in place |
| Mainnet anything | the legal checklist | Base Sepolia only |
| The rehearsed restore | before phase 2 | backups exist and have not been restored |
| A rehearsed incident drill | before phase 2 (X.1) | the playbook has not been walked end to end |
