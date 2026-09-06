# @kami/chain — on-chain tooling runbook

Idempotent scripts for the money and attestation layer (architecture §7, §8, §12.3; plan T2.2, T3.5). Every script records what it deployed in **config** and re-runs make zero writes. Every command takes `--dry-run`, which prints the calls and sends nothing.

**Sepolia first.** Base Sepolia (84532) is the default. Base mainnet (8453) is opt-in via `CHAIN_ID=8453` and is **not to be used before the legal checklist (T2.0, PRD §11 #2) is signed off and every row in `docs/verify.md` this package cites is ticked.**

## Invariants this package enforces in code

- The platform/deployer key is never a Safe owner (`assertOwnersValid`, checked before and after deployment).
- Threshold is 2 of exactly 3 owners: creator + guardian A + guardian B.
- The proposer key is a Transaction-Service *delegate*: it can create pending transactions and nothing else.
- `executeWithRelayer` refuses below the threshold; the relayer only pays gas.
- `enable-roles` / `update-recipients` only **propose**; two guardians sign.
- Schemas are registered `revocable: true` with no resolver; UIDs are computed locally and checked against the registry.
- No key is ever read from disk or printed. Keys come from an env var named on the command line (`--key-env`), or from a KMS-backed viem account supplied by the signing service.

## Environment

| var | used by | notes |
|---|---|---|
| `CHAIN_ID` | all | `84532` (default) or `8453` |
| `RPC_URL` | all | overrides the public RPC in `src/addresses.ts` |
| `PLATFORM_URL` + `PLATFORM_ADMIN_TOKEN` | config | when both are set, config is written to `POST $PLATFORM_URL/api/admin/config` (bearer); otherwise to `state/config.<chainId>.json` (gitignored; see `state/config.example.json`) |
| `KAMI_CHAIN_STATE` | config | explicit path for the JSON store |
| `SAFE_API_KEY` | api-kit | required by the Transaction Service at `api.safe.global` (https://developer.safe.global) |
| `DEPLOYER_KEY`, `ATTESTER_KEY`, `PROPOSER_KEY`, `GUARDIAN_KEY` | dev only | any name works; pass it with `--key-env NAME`. Never on the GPU box, never in a profile. |

## Commands and what they write

```
pnpm --filter @kami/chain chain <command> [--dry-run]      # or: bin/kami-chain.js
```

| command | does | writes to config |
|---|---|---|
| `addresses` | prints the chain table with the *verify* status of each address | — |
| `register-schemas --key-env ATTESTER_KEY` | computes each schema UID, `getSchema`, registers only if absent | `eas.schema.<Name>` |
| `deploy-hats --entity <slug> --key-env DEPLOYER_KEY` | platform top hat → entity admin hat → Guardian / Evaluator / Steward / VerifiedContributor | `hats.tree.platform.topHat`, `hats.tree.<slug>.admin`, `hats.tree.<slug>.<Role>` |
| `predict-safe --entity <slug> --owners a,b,c` | CREATE2 address for salt `keccak256("kami:"+slug)` (shown in the summon flow) | — |
| `deploy-safe --entity <slug> --owners creator,guardianA,guardianB --key-env DEPLOYER_KEY` | deploys Safe 1.4.1, threshold 2, verifies owners on chain | `safe.<slug>.address` |
| `add-delegate --entity <slug> --safe 0x… --delegate 0x… --label "kami proposer" --key-env GUARDIAN_KEY` | registers the proposer as a Tx-Service delegate; the guardian (an owner) signs | `safe.<slug>.proposer` |
| `attest-entity --entity <slug> --twin-uri <uri> --safe 0x… --guardians-hat <id> --key-env ATTESTER_KEY` | `EntityRegistered` onchain, revocable | `eas.attestation.EntityRegistered.<slug>` |
| `enable-roles --entity <slug> --safe 0x… --keeper 0x… --recipients a,b --key-env DEPLOYER_KEY --proposer-key-env PROPOSER_KEY` | deploys the Roles v2 proxy (deployer pays), then **proposes** one batch: enableModule + role `bounty-payer` scoped to `USDC.transfer`, `to ∈ recipients`, `amount ≤ 25 USDC`, 100 USDC / 24 h | `roles.<slug>.module`, `roles.<slug>.enableTxHash` |
| `update-recipients --entity <slug> --safe 0x… --recipients a,b --proposer-key-env PROPOSER_KEY` | **proposes** a re-scope with the new recipient set | — |

Order for a new chain: `register-schemas` → `deploy-hats` (once per entity) → `deploy-safe` → `add-delegate` → `attest-entity`. `enable-roles` is phase 3 only (ADR-E05).

## Library surface (for `apps/web/lib/signing`)

`buildUsdcTransferTx`, `proposeTransaction`, `getConfirmations`, `executeWithRelayer`, `listPendingTransactions`, `listIncomingTransfers` (`src/safe-tx.ts`); `attestOnchain`, `buildOffchainAttestation`, `verifyOffchain`, `timestampUids`, `merkleRootOfUids` (`src/eas.ts`); `predictSafeAddress`, `deploySafe`, `addDelegate` (`src/deploy-safe.ts`); `ConfigStore` (`src/config.ts`). Everything that talks to a network takes an injectable client so the signing service can pass KMS-backed accounts and tests pass fakes.

## Verify before mainnet (docs/verify.md)

- #7 Safe: `addSafeDelegate` needs the delegator's signature (api-kit 5 types say so: `delegatorAddress` + `signer`); incoming-transfers endpoint (`getIncomingTransactions`); no webhooks; canonical 1.4.1 deployments exist on 8453 and 84532 per `@safe-global/safe-deployments`.
- #8 Zodiac Roles v2 mastercopy `0x9646…D337` and ModuleProxyFactory `0x0000…a236` on Base / Base Sepolia; the condition-tree encoding in `src/enable-roles.ts` against the Roles SDK.
- #9 EAS `multiTimestamp` (present in eas-sdk 2.10.0); EAS domain version per chain (`DEFAULT_EAS_DOMAIN_VERSION`); GraphQL endpoint.
- #18 USDC on Base `0x8335…2913`; Base Sepolia USDC `0x036C…CF7e`.
- Hats v1 at `0x3bc1…d137` on Base Sepolia (the SDK's chain table does not list 84532; the scripts use viem + `HATS_ABI` directly).
- EAS / SchemaRegistry predeploys `0x4200…0021` / `0x4200…0020` (match `eas-contracts` 1.7.1 deployment files).

## Tests

`pnpm --filter @kami/chain typecheck` and `pnpm --filter @kami/chain test` — no network: Protocol Kit, api-kit, EAS and Hats are injected fakes; the pure parts (salts, hashes, encodings, the Roles condition tree, the refusal paths) are tested directly.
