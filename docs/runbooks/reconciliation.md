# Runbook — reconciliation

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<platform>/api/cron/reconcile | jq
```

Runs nightly at 03:40 UTC, once per entity. It compares what the database believes about money and
attestations against what the chain says, writes a `reconciliations` row with `{ok, findings}`, and
alerts the stewards when anything is an **error**.

`ok` is false when **any** finding has severity `error`. `warning` and `unverified` do not fail the
run — deliberately: an unreachable RPC endpoint is not evidence of a problem, and a night that
fails for want of a network call teaches people to ignore the alert.

Read the findings, do not skim them. Every one below has a different meaning and a different next
step.

---

## Errors — someone must act tonight

### `balance_mismatch`
The Safe's on-chain USDC balance does not match donations minus payouts, beyond rounding.

Most often a donation or transfer arrived that the platform never recorded — check
`treasury_transfers` and the incoming-transfer feed first; an unexpected **larger** balance is
usually a direct USDC donation to the Safe address, which is allowed and just needs recording. An
unexpected **smaller** balance is serious: reconcile every payout against the Safe's transaction
history by hand and go to `docs/runbooks/incident.md` §5 before doing anything else.

### `payout_tx_missing`
A payout row names a transaction that is not on chain, or whose receipt is not `success`.

Either the execution reverted (gas, allowance, a recipient that cannot receive) and the row should
not say it paid, or the row was written optimistically. Find the `safeTxHash` in Safe{Wallet}: if
it never executed, the payout must be re-proposed; if it executed and reverted, the money did not
move and the claimant has not been paid. **Tell the claimant either way.**

### `payout_uid_missing`
A payout exists with no `BountyCompleted` attestation.

The payment happened and the public record of it did not. Attest it. This is the finding that
quietly erodes the track record the whole design exists for, so do not defer it.

### `evaluation_uid_unresolved`
An evaluation carries an attestation identifier that the EAS index says does not exist.

Either the offchain attestation was never published, or the identifier was mistyped, or the
attestation was **revoked** — which is a normal outcome after an attester-key incident and should
be paired with a reputation recompute. Check the incident log before treating it as corruption.

### `event_chain_broken`
The `entity_events` hash chain does not verify at a named row.

This one is different from the rest: it means the append-only audit log has been altered or a write
was lost. The table has no UPDATE or DELETE grant for the app role and a trigger enforcing it, so
this should be impossible. **Treat it as a compromise until proven otherwise** — go to
`docs/runbooks/incident.md` §6, capture the row and its neighbours before touching anything, and
do not "repair" the chain.

---

## Warnings — act this week

### `no_safe`
The entity has money on the books and no Safe address.

Expected in phase 1, where guardians are roles and there is no treasury. Not expected once
donations are on. If donations are on, stop taking them until the Safe exists.

### `proposal_stale`
A Safe proposal has been waiting for signatures for days.

Nag the guardians; that is the whole remedy. Note the age and the amount — a proposal that ages out
of relevance should be rejected rather than left pending, because a stale queue is how a wrong
transaction gets signed by someone clearing the backlog. Rejecting costs nothing; the payout can be
re-proposed.

---

## Unverified — the check could not run, so nothing is known

### `balance_unverified`, `payout_tx_unverified`, `evaluation_uid_unverified`
The RPC endpoint, the Safe service, or the EAS GraphQL endpoint could not be reached, or is not
configured.

These are **honest silence, not a pass.** Nothing was checked. The right response is to fix the
endpoint and re-run — never to conclude the books balance.

If the same `unverified` finding appears three nights running, escalate it as if it were an error:
a check that never runs is a check that does not exist. If `EAS_GRAPHQL_URL` is simply unset,
evaluation findings will be `unverified` every night by design — set it, or accept that
attestation resolution is not being verified and say so out loud.

---

## Running it by hand

```bash
# One night, all entities.
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<platform>/api/cron/reconcile | jq '.[] | {entity, ok, findings}'

# The audit chain on its own.
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<platform>/api/cron/verify-chain | jq

# Reputation, after revoking anything.
curl -s -H "Authorization: Bearer $CRON_SECRET" https://<platform>/api/cron/reputation | jq
```

Past runs are in `reconciliations`, newest first, with their full findings. The latest error set is
also in `config` under `alerts.reconcile.<slug>`, which is what the stewards' alert reads from.

**Fix the cause, not the row.** Nothing in this runbook ever says "edit the database to make the
finding go away". If a finding is wrong, the check is wrong, and the check is the thing to fix.
