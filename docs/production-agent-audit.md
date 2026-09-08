# Production agent proof matrix

> **Current publication policy (September 7, 2026):** Consultation is encouraged as a being grows and is never required for setup, publication, chat or grant rounds. `entities.published_at` independently controls public visibility. Consultation records remain truthful and optional; publishing does not mark consultation complete. Guardian approval, spending safeguards and sensitive-data rules remain unchanged. Any older consultation-gate descriptions below are historical and superseded.

This is a live-proof checklist, not a completion claim. `docs/traceability.md` contains a historical fixture audit; its statements that no model has spoken predate the successful private Hermes/twin connection. A passing local suite proves application behavior against its dependencies; it does not prove provider provisioning, public model quality, human consent, payment settlement, or delivery.

## Reusable read-only audit

Run from `apps/web` with `PLATFORM_MCP_TOKEN` already in the environment, `AUDIT_EXPECTED_SLUG=boulder-creek`, and optionally `PLATFORM_URL=https://beings.earth` and `AUDIT_OUTPUT=/tmp/agent-audit.json`:

```sh
node --import tsx scripts/production-agent-audit.ts
```

The script pins the returned entity ID before continuing, never prints the token, refuses remote plaintext HTTP, disables redirects, times out requests, and records only scoped summary evidence. It initializes real production MCP, checks all nine advertised tools, invokes the seven read tools, verifies missing evidence refusal, reads both treasury endpoints and state, and verifies anonymous and cross-entity refusal. The only request to a mutation route is a treasury rejection probe while confirmed paused using a random nonexistent submission. `validatePayoutProposal` checks `pausedAt` before Safe lookup, submission lookup, signing or writes, and the nonexistent ID independently prevents an actual payout if pause changes during the test.

`post_update` and `draft_bounty` are never called by this read-only audit. At inspection on September 7 they had no pause guard in `lib/mcp/tools.ts` or `lib/jobs/drafts.ts`; this was escalated for repair. Their registration is checked, but registration is not proof of successful guarded publishing.

Evidence summaries must contain structured data only: 500-character maximum free-text strings, stripped links, no file bodies/base64/blob/raw/R2 keys, bounded depth six and arrays/objects 64 entries. Real successful evidence access additionally requires an existing authorized submission. The missing-ID test proves refusal only, not sanitization of a real upload.

## Live acceptance matrix

| PRD requirement / journey | Existing surface to exercise | Required production evidence / prerequisites |
|---|---|---|
| J1; G3 summon under 20 minutes | `/sign-in`, `/summon`, entity `/connect`; reviewed bindings | New real user inbox, accepted age declaration, real discovered place IDs, timed uninterrupted flow, approved binding and soul. Two actual guardian invitees must accept; steward consultation record is a real assertion, never a test toggle. |
| §4.2 senses, G4 mood | `get_entity_config`, `get_needs_snapshot`, twin `get_place` | Approved binding IDs, real snapshot hash/time/provenance, stale/unbanded truthfulness. Fixture property tests establish stale behavior; a live snapshot establishes deployed wiring. No published band means no comparative score. |
| §6.1 habitat/disclosure, G7 | `/e/[slug]`, `/chat`, `/how-i-work` | Authenticated private preview and anonymous refusal; public entity only after consultation. Mobile/keyboard/reduced-motion screenshots; actual model and accepted guardians displayed. |
| J5; G1 guarded conversation | local Hermes plus authenticated runtime adapter and website chat SSE | Public TLS runtime route, scoped tool credentials, current-turn tool evidence through factguard, real model responses and adversarial 200-turn evaluation, ≥95% missing-reading probe accuracy, disclosure reminder cadence. A private CLI response alone does not prove website guard. |
| J2 hourly pulse | cron needs/precheck/pulse + `post_update` | Scheduled invocation with unchanged-data no-model proof, changed-data guarded pulse, published status only after consultation, real runtime heartbeat; record actual timestamps, event IDs and output hashes. |
| §4.7 weekly and quarterly learning | `draft_bounty`, `post_update(strategy)`, `get_strategy` | Live pause guards, schedule configured for installed Hermes version, real model draft, human review/ratification and comment window, no fictional claims of evaluated outcomes. Independent guardian approval records required. |
| J2 bounty lifecycle | `/e/[slug]/proposals`, governance bounties/strategies functions | Valid evidence spec, bound twin refs, caps, ≤3 weekly drafts; two real guardian approvals; deadlines and actual board transitions. Fixtures cover constraints but are not real approval. |
| J3 claim/evidence | proposals detail, `/api/evidence/upload`, `/api/evidence/finalize`, `/me` | A real claimant, accepted evidence licence, provisioned private object store and malware scanning, valid uploaded object checksum, scoped download proof. Agent sees sanitized summary, never uploaded instructions or file body. |
| J3 evaluator | governance evaluations, `list_submissions`, `read_evidence_summary` | Independent accepted evaluator identity/Hat, actual evaluation with signed ProposalOutcome attestation; claimant/proposer cannot evaluate own work. Missing submission tests do not establish this path. |
| §7.2 sensor verification | tier-1 prediction and baseline/after window | Real outcome window elapsed, required twin observations, measured comparison; no accelerated invented ecological outcomes. |
| G2/G5 treasury | treasury MCP `get_balance`, `list_pending`, `propose_bounty_payout`; `/api/treasury/propose`, `/confirm` | Funded Safe on intended chain with ≥2 human owners/signatures, proposer-only delegate, RPC/Transaction Service, actual independent successful evaluation, recipient wallet. Capture Safe tx hash, receipt and BountyCompleted UID. Never simulate human signatures or transfer real money as a smoke test. |
| J3 contributor wallet | wallet/Privy and off-ramp UI | Provisioned wallet provider app, actual user wallet creation, chain-matched address, available off-ramp; no agent custody of user seed. |
| J4 donations | `/api/donate`, Stripe webhook, donation reconciliation | Legal merchant/fiscal wrapper, real Stripe account and webhook secret, supported conversion rail, explicit authorized payment amount, settled transfer to Safe. Provider sandbox success is separate from real settlement. |
| G6 donor reports | `/api/cron/donor-report`, report delivery records | Real donor consent/address, Resend delivery, all settled payouts/UIDs and receipts, measured 31-day deadline/coverage. Sending messages requires specific user authorization; do not email trial donors. |
| §7.3 reputation | `/api/cron/reputation`, attestation summary, people | Real outcome attestations, revocation-aware score and decay, private/public eligibility; fixture math is not earned reputation. |
| §9.4 commons memory | Parachute/commons publisher and entity vault | Revocable scoped Parachute token, dedicated entities vault, deliberate publish permission, CC BY-SA attribution, conditional update conflict proof; production document IDs and actual revisions. |
| G8 pause and recovery | guardian pause, platform jobs, runtime pause sync, treasury refusal | Two genuine guardians; timed authorized drill proving chat/cron/proposals halt within 60 seconds and platform-unreachable fail-closed behavior. No unpause of Boulder Creek for testing without the real governance conditions. |
| §8.5 evaluation/change management | `evals` live model runner | Actual deployed model identity, full live probe result artifacts, guard/evidence counts, no fixture substitution; baseline comparison before model changes. |
| §13 privacy/retention | age gate, reminders, transcript opt-in/deletion, evidence access | Real configured cleanup schedules and deletion reports, access/refusal checks, opt-in records; annual reporting policy and report owner. |
| Phase 3 grant/retro rounds and coalitions | Grant application lifecycle implemented; retro allocation and coalitions remain future | Dedicated draft/open/closed rounds support planning budgets, deadlines, applications by proposal owners, moderation audit and existing bounty links. Opening requires active, consulted status. This does not implement reserved funding, retro voting or shared coalition treasuries. |

## Proof vocabulary

- **Fixture tested:** deterministic tests passed against synthetic or mocked dependencies.
- **Live read verified:** an authenticated deployed endpoint returned actual scoped data (empty counts are valid).
- **Live refusal verified:** deployed endpoint rejected the tested request; no success-path claim follows.
- **End-to-end verified:** actual authorized actors, providers, durable state and resulting output were observed together.
- **Blocked:** external actor/configuration, elapsed ecological window, policy decision or missing implementation remains.

The generated report preserves HTTP codes, snapshot version/hash/as-of, counts and configured state. It deliberately does not preserve tokens, raw tool messages, people names, claimant identity or evidence contents. Store a report privately unless its entity has been approved for public disclosure.

## September 7, 2026 live run

At `2026-09-07T22:40:16Z`, the script completed against `https://beings.earth` with **22 passing checks and two deliberately uninvoked mutation tools**. The private entity token resolved to the expected Boulder Creek entity. Approved binding v2 exposed 12 member places and five need mappings. Snapshot 1 existed with its hash, timestamp and all required provenance fields. This snapshot was asleep, stale-driving and runtime-offline.

The entity had no accepted guardians or evaluators, no strategy, bounties, submissions or attestations. Treasury correctly returned `balance_usdc:null` with `reason:no_safe`, and zero pending proposals. The guaranteed-invalid paused payout probe returned HTTP 423 `entity_paused`; anonymous MCP returned 401 and cross-entity treasury returned 403. No pulse, bounty, payout, email or governance record was created. Raw summary remains private in `/tmp/beings-production-agent-audit.json` for this local session.

## Release review: what still prevents “100% live”

The runtime has progressed beyond the first audit: the real local guarded Hermes → OpenAI loop passed a live twin call, and the Mac bridge/gate/harness/router/tunnel services are installed with a stable HTTPS router. See `docs/runtime-implementation.md` for the exact evidence and boundaries. Boulder Creek remains deliberately paused; a 423 response proves that pause is enforced, not that an active public chat completed. The private Blob store also passed an actual write/read/delete smoke test and rejected anonymous object access with 403. Temporary QA data was removed. Upload/finalize with an actual claimant is a separate uncompleted proof.

Remaining acceptance items, in order:

1. **Human governance and release.** Production audit found zero accepted guardians and evaluators. J1 expects creator plus two guardian Safe owners (2-of-3), while G8 additionally expects independent guardians. Obtain actual accepted roles, complete the real consultation, and perform an authorized timed pause/recovery drill. Do not create fictional people or silently change consultation/unpause flags to make tests pass.
2. **Public agent loop and long-running learning.** A private guarded conversation and installed services are not an observed week of hourly pulses, Monday drafts, quarterly strategies and monthly reports. Verify the deployed secret/route configuration, actual runtime heartbeat, installed-version cron commands, unchanged-input no-token behavior, retry/deduplication and pause stopping all mutation paths. Run the full model hallucination suite before claiming G1, then capture a real approved strategy and its eventual evaluation. Mac sleep is an availability dependency.
3. **Signed outcomes and real money.** `governance/attest.ts` still defaults to a deterministic unsigned `pending:` reference. Existing bytes32 checks already exclude that placeholder from payouts and reputation; the release adds exclusion of valid-shaped offchain UIDs without signatures as well. This is eligibility screening, not cryptographic verification. A real EAS/Privy evaluator-signing and verified ingestion flow remains necessary. Correctly signed offchain outcomes need not be onchain to qualify. Funded chain-matched Safe, actual human signatures, proposer-only delegate, recipient wallet and confirmed completed attestation remain unproven.
4. **Stripe and conversion.** Existing Checkout/webhook code means no new payment provider choice is needed merely to expose an interface. Live configuration and settlement were not verified: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, merchant/fiscal-wrapper account, supported conversion rail and Safe reconciliation must be real. Whether another integration is required depends on that existing account's capabilities; do not assume the provisioned email/Blob integrations enable payments. A payment or donor email requires an explicitly authorized real transaction/recipient.
5. **Claimant evidence journey.** Private Blob, signed upload grants, bounded body size, staged-file checks and hash verification are implemented. Complete a real claim → upload → finalize → independent evaluator journey; inspect any required capture/provenance/scanning policy and validate against that policy. Do not confuse storage privacy with successful evidence verification or antivirus scanning.
6. **Commons publication.** Code exists for conditional Parachute updates, entity templates, licences and ownership fences. Production needs `PARACHUTE_HUB_URL`, `PARACHUTE_ENTITIES_TOKEN`, and the intended `PARACHUTE_ENTITIES_VAULT`, followed by an explicitly authorized real note create/update/conflict proof. No fake public note should stand in for that integration.
7. **Grant rounds and coalition treasuries.** Retro rounds appear in PRD phase 3, while shared coalition treasuries are a later user-requested roadmap addition. A dedicated grant application lifecycle is now implemented with budget/deadline models, own-proposal eligibility, moderator controls and bounty links. Retro allocation, fund reservation and coalition treasury workflows remain future work; grant budgets are planning values only.
8. **Measured product acceptance.** Under-20-minute stranger onboarding, 31-day donor report coverage, 200-turn guard performance, ≥95% refusal probe and the complete real bounty outcome cannot be established by fixture tests or a static deployment. Record each timed/real artifact separately.

Code improvements available without impersonating external actors include explicit unsigned-attestation gating, guardian approval-expiry enforcement, and a readiness checklist using actual role/provider/runtime states. These improve the path to acceptance; they do not replace the actors and outcomes listed above.

### Dependency review

`@vercel/blob` is pinned to `2.8.0`. Lockfile inspection found 24 added package resolutions and no removed existing resolutions. Added dependencies belong to the Blob SDK/OIDC/CLI-auth dependency tree (including retry, undici, jose and process-launch helpers); Privy's optional Blob peer caused peer-context snapshot rewrites. No other direct dependency version was changed. The large lockfile diff reflects those peer-context changes, not a broad application dependency upgrade.
