# Optional consultation policy — September 7, 2026

The product owner explicitly directed that consultation with local Indigenous groups be encouraged as an ecological entity grows, never required. This supersedes the blanket consultation-before-launch rule in the earlier PRD and historical audits. Sensitive-data handling, truthful authorship and restrictions on claiming to represent communities are unchanged.

Publication now has an independent `entities.published_at` field. Migration 0004 preserves existing visibility by backfilling only previously public entities; private drafts stay private. Recording consultation neither publishes nor unpauses an entity. Explicit publication requires an accepted steward or platform administrator, preserves pause and treasury state, and emits an `entity.published` audit event. Optional consultation dates and prose remain factual records.

The public registry, per-page access checks, chat access, private dashboard reads, status-file access, needs publication and grants now use publication state. A grant round still needs an active, published being; it does not need consultation. Existing guardian, evidence and spending controls are unchanged.

Validation: 16 schema/migration tests, 24 read/privacy/chat/needs tests, 21 summon/grant tests and 23 UI/copy/action tests passed in focused runs. Typecheck passed. Tests include public entities with no consultation, private entities with a consultation record, preserved historical visibility, publication authorization and idempotent audit events. These counts describe separate focused runs, not a comprehensive full-suite run.

Production verification: code release `104f83f` deployed successfully. The signed-in steward published Boulder Creek through its connection page at 2026-09-08T00:14:35.593Z. Consultation remained null and the original pause timestamp was unchanged. Refresh needs succeeded with a public snapshot as-of 00:14:56.752Z. Anonymous page access returned HTTP 200 with ecological senses and no private-preview banner. Agent activation and treasury settlement remain separate, outstanding steps.
