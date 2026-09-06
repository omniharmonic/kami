# ADR-E07 — Email-first identity with Privy embedded wallets provisioned lazily

**Status:** accepted for build (2026-09-06)
**Context.** "Sign up with their email." B2 §4.2: Privy is free under 499 MAU and has a Safe signer guide; Better Auth (Vercel-owned, v1.7.x) and Neon Auth do magic links.
**Decision.** Better Auth magic links (*verify* the magic-link plugin in v1.7; Neon Auth is the fallback) are the only login. A Privy embedded wallet is created the first time a user needs one — claiming a bounty, accepting guardianship, or opening `/me/wallet` — and its address is stored on `users`. Privy is never the identity provider; it is a wallet provider keyed by our user id.
**Consequences.** (+) Visitors, donors and creators never see a wallet. (+) Privy is replaceable behind one table column. (−) Two vendors for one person; the reconciliation is `users.privy_did`.
**Alternatives rejected.** Privy as the auth provider (vendor lock on identity); Base Account passkeys (not email-native); wallets for everyone at signup (needless MAU).

## Build notes

_None yet._
