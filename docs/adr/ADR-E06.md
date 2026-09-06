# ADR-E06 — Off-chain proposals and evaluations in Postgres; on-chain outcomes and payouts as EAS attestations; reputation as a deterministic function over published UIDs

**Status:** accepted for build (2026-09-06)
**Context.** PRD §7.7 draws the line at outcomes. B2 §5: EAS onchain attestations cost cents on Base; offchain ones are free and can be timestamped.
**Decision.** Postgres holds proposals, bounty specs, submissions, evaluation notes, chats, pulses. EAS on Base holds `EntityRegistered` (once), `BountyCompleted` (onchain, carries `safeTxHash`), `ProposalOutcome` (offchain-signed by the evaluator's wallet, timestamped onchain nightly — *verify* `multiTimestamp`), `BountyPosted` (offchain, timestamped), `ReputationSnapshot` (weekly, onchain, Merkle root of input UIDs). Reputation is computed nightly by a versioned pure function (§8.3) over attestation UIDs and published with the UID list.
**Consequences.** (+) The track record is portable and tamper-evident; the process is fast and editable. (+) Anyone can recompute. (−) Two sources of truth for outcomes (row + attestation); the row stores the UID and the nightly reconciliation asserts they agree.
**Alternatives rejected.** Everything on chain (cost, privacy, editability); nothing on chain (the owner's stated reason for the chain is the track record); Karma GAP wholesale (phase-3 option, PRD §11 #6).

## Build notes

_None yet._
