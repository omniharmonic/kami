# Schema gaps

Columns the build wanted that the architecture's Appendix B does not have. Each is worked around today; the SQL is written out so the decision is one review away rather than one investigation away. Nothing here blocks a phase gate.

| # | Gap | Worked around by | Proposed SQL | Owner's call |
|---|---|---|---|---|
| 1 | `evidence_files` has no `claim_id`. Files are staged before the submission exists. | Matching by the server-written key prefix `evidence/<slug>/<claim_id>/`. The client never writes the key. | `ALTER TABLE evidence_files ADD COLUMN claim_id text REFERENCES claims(id); CREATE INDEX evidence_files_claim_id_idx ON evidence_files (claim_id) WHERE submission_id IS NULL;` | Worth doing — the prefix is load-bearing today. |
| 2 | `evidence_files` has no `licence_version`, so which terms a contributor accepted is not recorded. | `licence_accepted_at` only. | `ALTER TABLE evidence_files ADD COLUMN licence_version text;` | Worth doing before the terms are ever revised. |
| 3 | No column for a tier-4 follow-up date. | `config.tier4_followups` keyed by bounty id, carrying `{submission_id, evaluation_id, deposit_usdc, balance_usdc, follow_up_due, followed_up_at}`. | `ALTER TABLE bounties ADD COLUMN follow_up_due date;` | Optional. The config map works and tier 4 is rare. |
| 4 | No `users.contribute_opt_in`. | `config.contribute_opt_in_users` as a `{user_id: bool}` map, mirrored onto that user's `chat_sessions.contribute_opt_in`, which is the column retention actually reads. | `ALTER TABLE users ADD COLUMN contribute_opt_in boolean NOT NULL DEFAULT false;` | Optional. The mirror is what retention honours, so the behaviour is already correct. |
| 5 | `guardian_invites` has no `role`, so only guardians can be invited by email. | Evaluators and stewards are granted directly by a steward. | `ALTER TABLE guardian_invites ADD COLUMN role entity_role NOT NULL DEFAULT 'guardian';` | Wanted when evaluator recruitment goes self-serve (phase 3). |
| 6 | Nothing enforces "one first evaluation per submission" at the database level. | Enforced in code in `evaluate()`. | `CREATE UNIQUE INDEX evaluations_one_first_per_submission ON evaluations (submission_id) WHERE audit_of IS NULL;` | Worth doing — it costs nothing and the code already upholds it. |
| 7 | `payouts` cannot distinguish a tier-4 deposit from its balance; both are rows against one submission. | Order and amount. | `ALTER TABLE payouts ADD COLUMN kind text;` | Wanted before the first tier-4 balance is paid. |

## From the money layer

| # | Gap | Worked around by | Proposed SQL | Owner's call |
|---|---|---|---|---|
| 8 | `safe_proposals` records no proposer address, so which key proposed a payout lives only in `entity_events`. | The event log. | `ALTER TABLE safe_proposals ADD COLUMN proposer_address text;` | Worth doing — proposer keys rotate quarterly and reconciliation should not have to read the event log. |
| 9 | Nothing at the database level stops one Safe transaction being paid twice. | `payouts.id` is derived as `pay_<safeTxHash[0:24]>`, so a repeat insert collides on the primary key. | `CREATE UNIQUE INDEX payouts_safe_tx_hash_key ON payouts (safe_tx_hash) WHERE safe_tx_hash IS NOT NULL;` | Worth doing — double execution is the expensive mistake. |
| 10 | `reputation_scores.entity_id` is `NOT NULL` (it is in the primary key), but `reputation/v1` publishes a cross-entity row whose entity is null. | Stored under the sentinel `"*"`. | Allow NULL with a partial unique index, or bless `"*"` explicitly. | Decide before anyone queries the table directly. |
| 11 | No `payouts.entity_id`; attribution runs `submissions → claims → bounties`. | The join. | `ALTER TABLE payouts ADD COLUMN entity_id text REFERENCES entities(id);` | Optional. It would simplify reconciliation. |
| 12 | `evaluations.offchain_attestation` (`{uid, awarded_usdc?}`) and `bounties.prediction` are conventions, not constraints. | Zod at the edges, asserted in tests. | A `CHECK` on `jsonb_typeof`, or leave documented. | Optional. |

## Two pause implementations

`src/lib/governance/pause.ts` (used by the guardian screens) and `src/lib/jobs/pause.ts` (used by `POST /api/entities/[slug]/pause`, which the box scripts call) were written independently. They write compatible `pause_events` rows, so the two-guardian resume rule counts requests arriving by either path — the safety property holds. They differ in the `entity_events` kind spelling (`resume_requested` versus `resume.requested`) and in whether `actor` is a user id or a display label. Unify on one module before phase 2; the guardian-screen version is the fuller one.
