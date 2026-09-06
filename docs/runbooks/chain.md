# Runbook — chain

```bash
pnpm --filter @kami/chain chain addresses      # which chain, which contracts, what is unverified
```

**`infra/chain/README.md` is the manual** — every command, what it writes to config, the order for
a new chain, the library surface the web app uses, and the addresses still to be confirmed. This
file adds only what is not there: **key rotation**, and the standing rules about mainnet.

---

## Two rules that are not negotiable

1. **Base Sepolia until the legal checklist is signed off.** `CHAIN_ID=84532` is the default;
   `8453` is opt-in and is not to be used before every box in `docs/legal/CHECKLIST.md` is ticked.
   That is a hard gate, not a preference.
2. **Every command takes `--dry-run`, and every command gets one first.** The scripts are
   idempotent, so a re-run writes nothing; a dry run tells you whether it is about to.

## Which key is which

| Key | Can do | Cannot do | Rotates |
|---|---|---|---|
| **Deployer** | deploy a Safe, deploy Hats, deploy a Roles module | own a Safe, sign a payout | annually, and on incident |
| **Proposer** (one per entity) | create a pending Safe transaction as a Transaction-Service delegate | sign, execute, or add owners | **quarterly**, and on incident |
| **Attester** | write EAS attestations | move value | annually, and on incident |
| **Relayer** | pay gas and submit a transaction two humans already signed | change what it submits | annually, and on incident |
| **Guardian** | sign and execute Safe transactions | — | held by a person, never by us |

Every one of them lives in KMS or in a server-wallet provider, and every one of them is used
through the signing service. **None of them is ever on the GPU box, in a profile, or in this
repository.** `bash scripts/security-check.sh` enforces that.

The deployer is checked, before and after every deployment, not to be a Safe owner. The threshold
is 2 of exactly 3.

## Rotating the proposer key — the quarterly one

The proposer is a delegate, not an owner, so rotating it is safe to do on a normal afternoon.

```bash
# 1. Mint a new key in the signing service (KMS) and note its address.
# 2. A guardian — an owner — signs the delegate registration.
pnpm --filter @kami/chain chain add-delegate --entity <slug> --safe 0x… \
  --delegate <new-address> --label "kami proposer <yyyy-qN>" --key-env GUARDIAN_KEY --dry-run
```

3. Run it without `--dry-run`.
4. **Remove the old delegate.** A rotation that leaves the old one registered is not a rotation.
5. Point the signing service at the new key and restart it.
6. Confirm: the treasury MCP's `propose_bounty_payout` produces a pending transaction, and it is
   attributed to the new address in Safe{Wallet}.
7. Both writes appear in `entity_events`. Check the hash chain still verifies:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<platform>/api/cron/verify-chain`.

The proposer key records the address that proposed each payout only in the event log today — see
`docs/schema-gaps.md` #8. After a rotation, reconciliation cannot tell you which key proposed
what; the event log can.

## Rotating the attester key

Attestations signed by the old key stay valid **unless the key was compromised**, in which case
revoke the ones made after the incident time — every schema is registered `revocable: true` for
exactly this — and let the nightly reconciliation recompute reputation without them.

```bash
pnpm --filter @kami/chain chain register-schemas --key-env ATTESTER_KEY --dry-run   # no-op if present
```

Schema UIDs are derived from the schema text, not from the key, so a new attester key does not
change them. Update the signing service, then check one new evaluation attests and resolves.

## Rotating the relayer key

Move the float to the new address, point the signing service at it, and **re-apply the float cap**.
An uncapped relayer is a standing invitation. Confirm a payout still executes end to end on Base
Sepolia before you consider it done.

## Rotating a guardian

That is a Safe owner change, not a key rotation: the two remaining owners execute `swapOwner`. It
belongs to the guardians, not to an operator. If two of three owners are suspect, the third
executes nothing — the funds are safe behind the threshold. See `docs/runbooks/incident.md` §5.

## When something does not match

`pnpm --filter @kami/chain chain addresses` prints a VERIFY flag beside every address that has not
been confirmed against a live deployment. A mismatch there is the first thing to check when a
script fails on a chain you have not used before. Do not "fix" it by hardcoding an address a block
explorer showed you; confirm it, then write the confirmation into `docs/verify.md`.
