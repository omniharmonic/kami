# ADR-E05 — Agent as proposer only; Safe 2-of-3 per entity; Roles allowance only in the allowance phase, capped

**Status:** accepted for build (2026-09-06)
**Context.** The owner: "all transactions approved by humans but proposed by the agent." B2 §4.1: Safe + Transaction Service delegates match exactly; Zodiac Roles v2 allows scoped allowances later.
**Decision.** One Safe per entity on Base, owners = creator + two guardians, threshold 2; the platform is **not** an owner. The agent's proposer key is a Transaction-Service delegate (*verify* `addSafeDelegate` needs an owner signature). The treasury MCP the agent sees has `get_balance`, `list_pending`, `propose_bounty_payout` and no sign/execute tool; it holds no key at all — it calls the platform's signing service, which holds the proposer key. Signed transactions are executed by a platform **relayer** key that pays gas; guardians only sign EIP-712 hashes. In the allowance phase a Roles v2 role `bounty-payer` permits `USDC.transfer(to ∈ verified-contributor set, amount ≤ 25 USDC)` with 100 USDC per 24 h; nothing else changes.
**Consequences.** (+) Zero agent-signed value movement in v1 is structurally true, not a policy. (+) Box compromise yields only the ability to create pending proposals guardians can see. (−) Guardians must sign twice per payout in the worst case (approve bounty, sign tx) — §7 reduces this to one screen. (−) Delegate registration needs a guardian signature at summon and at rotation.
**Alternatives rejected.** Agent as a Safe owner with threshold (an owner can still be phished into signing); Coinbase Agentic Wallets as the treasury (policy-only, no human approval); a platform-custodied hot wallet.

## Build notes

_None yet._
