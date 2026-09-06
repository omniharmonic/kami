# Verify before relying

Carried from PRD Appendix C and architecture Appendix D. Tick as confirmed; cite the source. Anything marked *verify* in code or docs must have a row here.

| # | Item | Settled by | Status | Note |
|---|---|---|---|---|
| 1 | Hermes v0.21.0 exact tag; per-profile API routing in multiplexed mode; cron pause via `/api/jobs`; profile reload; `disabled_toolsets` names; tool-call log exposure | T0.3 | open | needs a live Hermes install |
| 2 | vLLM flag set and vllm#42021 on Qwen3.5-9B; KV budget for 64k | T0.2 | open | needs the GPU box |
| 3 | MCP TS SDK stateless handler; Workers rate-limit binding; registry submission | WP1 | open | `@modelcontextprotocol/sdk` 1.30.0 used; `@modelcontextprotocol/server` 2.0.0 exists on npm |
| 4 | `sources/ids-schema.json` kind enum includes `stream_reach` | survey | **confirmed** | `frontrange-twin/sources/ids-schema.json` enum lists `stream_reach` |
| 5 | CORS on `data.bioregionaltwin.org` | TW-10 | open | sandbox cannot reach the host |
| 6 | Parachute cross-vault wikilinks, second publication, MCP endpoint pattern, token TTL | WP7 | open | |
| 7 | Safe Transaction Service `addSafeDelegate` signature; incoming-transfer endpoint; no webhooks; CREATE2 on Base; Sepolia deployments | WP10 | open | |
| 8 | Zodiac Roles v2 Base addresses | WP10 | open | |
| 9 | EAS `multiTimestamp`; GraphQL endpoint for Base | WP10/WP12 | open | |
| 10 | Hats `isWearerOfHat`; Human Passport v2 scale | WP11 | open | |
| 11 | Privy limits/pricing; EIP-712 from embedded wallets | WP11 | open | |
| 12 | Better Auth 1.7 magic-link plugin; Neon Auth fallback | WP6 | **confirmed (sandbox)** | better-auth@1.7.3: `better-auth/plugins/magic-link`, `better-auth/adapters/drizzle`, `hooks.before` sees the raw body; `apps/web/src/lib/__tests__/auth.test.ts` signs in, verifies, and checks the 30-day cookie against PGlite. Not yet exercised against Resend or a browser |
| 13 | Stripe USDC payout availability; stablecoin checkout fee | WP11 | open | |
| 14 | Coinbase off-ramp; gasless USDC scope | WP11 | open | |
| 15 | Rive plan tiers/licence; data-binding API | WP8 | open | @rive-app/react-canvas 4.34.1 |
| 16 | Resend tier; Cloudflare Access vs Tailscale | WP5 | open | |
| 17 | EU AI Act Art. 50 marker; SB 243 cadence for minors; CO charitable solicitation | WP15 / counsel | open | |
| 18 | USDC on Base `0x8335…2913`; safety classifier | WP10 / WP4 | open | |
| 19 | Hetzner GEX44/GEX131 prices | owner | open | |
| 20 | Karma GAP on Base; Optimism retro mechanics | WP14 | open | |
| 21 | HCB crypto acceptance; Endaoment terms | counsel | open | |
| 22 | Nederland guardians / Tribal offices | owner conversation | open | gates public launch |
| 23 | Season snowline nudge thresholds (`RUNOFF_SNOWLINE_M` 2400 m, `FREEZE_SNOWLINE_M` 2000 m) in `packages/needs/src/season.ts` | WP3 | open | first guess; date decides, snowline only nudges edges |
| 24 | Placeholder DO / pm25 / snow values and times in `packages/needs/test/fixtures/boulder-creek-2026-09-06.json` | WP3 → WP16 | open | replace with the twin-mcp fixture tree values once WP1 lands |
| 25 | Hermes image name/tag (`nousresearch/hermes-agent:v0.21.0` vs `v2026.8.31`); `hermes cron add/remove/run/doctor` flag names mapped in `profiles/templates/cron.yaml`; reload without restart; `POST /api/jobs/pause`; `paused:` profile key; `gateway.multiplex_profiles` key path; API server env names; unprivileged image user | WP5 → T0.3 on the box | open | runbook table in `infra/box/README.md` |
| 26 | Pinned container tags in `infra/box/.env.example` (cloudflared 2025.8.1, otel-collector-contrib 0.135.0, tailscale v1.86.2, uv 0.9.5) | WP5 | open | |
| 27 | `UV_PROJECT=/opt/kami/treasury-mcp` so the template's verbatim `uv run treasury-mcp` resolves inside the Hermes container | WP5/WP10 | open | |
| 28 | `PLATFORM_URL` production value (no platform domain decided) | owner | open | dev default `http://127.0.0.1:3000` |
| 29 | vLLM emits `usage` in the final streamed chunk with `stream_options.include_usage` (gate falls back to a chars/4 estimate) | WP4 → box | open | |
| 30 | Platform pause-set endpoint shape consumed by the gate (`{"paused": [slug…]}`, bearer `KAMI_PLATFORM_TOKEN`) | WP7 | open | align when `/api/gate/pause-set` lands |
| 31 | `KAMI_ENTITY_CONFIG:` system-message convention (platform-injected caps/guardian names the guard admits as atoms) | WP5/WP7 | open | |
| 36 | Next 16 `proxy.ts` (renamed middleware) rewriting `POST /e/[slug]/chat` → `/api/e/[slug]/chat`; a page and a route handler cannot share a segment | WP6 | open | `PROXY_FILENAME = 'proxy'` in next@16.3.4 constants; rewrite preserves method+body per Next docs — confirm on a Vercel preview |
| 37 | `CREATE ROLE kami_app` from the migration on Neon (owner role has CREATEROLE?) | WP6 | open | migration 0002 is guarded with IF NOT EXISTS; the append-only trigger holds regardless of role |
| 38 | SB 243 reminder cadence (`config.reminder_every_turns`, default 12) for minors | WP6 / counsel | open | counted by the web app in `chat_sessions.turns` |
| 39 | Gate `event: toolcalls` payload shape `{calls: [{tool, place_id, time, source_id, stale, source_status?}], guard_dropped}` as assumed by `apps/web/src/lib/gateway.ts` | WP4 ↔ WP6 | open | the fake gateway emits this shape; align with `apps/gate` |
| 40 | `@neondatabase/serverless` Pool over WebSocket on Vercel Node runtime (no `ws` shim needed on Node 22) | WP6 | open | chosen for interactive transactions (`appendEntityEvent`) |
| 32 | Orodell's live `huc12` is `101900050301` (HUC-10 `1019000503`), outside the binding's `…0504–0507`; the canonical binding may need `watershed/huc10-1019000503` or will warn on rule 5 | WP2 → live tree | open | fixture HUC-12s are synthetic |
| 33 | Twin ids `place/lake-eldora`, `place/university-camp-2`, `place/union-reservoir`, `place/leggett-valmont-reservoir`, `place/six-mile-reservoir` exist under those slugs with `swe` / `reservoir_storage` | WP2 → live tree | open | slug guesses from PRD App. B |
| 34 | Forebay WQ site has no `discharge` datastream (else `proposeBinding` classifies it `gauge`) | WP2 | open | |
| 35 | `SOURCE_THRESHOLDS` in `packages/twin-client` is a transcription of `sources.seed.yaml`; prefer `latest/health.json` at runtime | WP2 | open | code already prefers health.json |
| 41 | USDC Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`; EAS `0x4200…0021` / SchemaRegistry `0x4200…0020` on Base + Base Sepolia (match `eas-contracts` 1.7.1 deployment files locally); EAS EIP-712 domain version read from the contract at runtime | WP10 | open | `infra/chain/src/addresses.ts` prints VERIFY flags |
| 42 | Hats v1 `0x3bc1A0Ad72417f2d411118085256fC53CBdDd137` on Base Sepolia (SDK chain table lacks 84532; scripts call the ABI via viem) | WP10 | open | |
| 43 | Zodiac Roles v2 mastercopy `0x9646fDAD06d3e24444381f44362a3B0eB343D337`, ModuleProxyFactory `0x000000000000aDdB49795b0f9bA5BC298cDda236`; condition-tree encoding and CREATE2 proxy derivation against the Roles SDK | WP10 → T3.5 | open | `evaluateConditions` is a local model, not the contract |
| 44 | Safe: `addSafeDelegate` requires the delegator (owner) signature — confirmed by api-kit 5.0.3 types; `api.safe.global` now requires `SAFE_API_KEY`; Safe Allowance module on Base `0xAA46…091C`, none on Base Sepolia | WP10 | partly confirmed | |
| 45 | `@ethereum-attestation-service/eas-sdk` 2.10.0 ESM build breaks under native Node (`lodash` named import); loaded via its CJS build in `infra/chain/src/eas-sdk.ts` | WP10 | confirmed | re-check on SDK upgrade |
| 46 | `User-Agent` contact address `contact@bioregionaltwin.org` for the twin MCP | WP1 → twin operator | open | |
| 47 | Transport: `@modelcontextprotocol/sdk` 1.30.0 `WebStandardStreamableHTTPServerTransport` for the Worker; `@modelcontextprotocol/server` 2.0.0 not adopted | WP1 | decided | revisit when the twin publishes |
| 48 | Workers Rate Limiting binding availability; `ajv` uses `new Function` (forbidden on Workers) — swap `@cfworker/json-schema` for `resolve_entity` with `binding_url` before deploying the Worker | WP1 → twin deploy | open | |
| 49 | Real WBD HUC-10/12 codes and shapes for Boulder Creek (fixture rectangles are synthetic; see row 32) | WP1/WP2 → live tree | open | |
| 60 | Privy server wallets for the platform roles: `walletApi.ethereum.{signMessage,signTypedData,signTransaction}` names and response shapes (from the installed 1.32.5 declarations), the transaction body's field names (`gasLimit`, hex quantities) and the signature encoding; one live Base Sepolia call settles it | WP10 | open | `apps/web/src/lib/signing/kms.ts` `PrivyServerWalletBackend` |
| 61 | eas-sdk 2.10 `Transaction.receipt.hash` after `wait()` — the tx hash the nightly `multiTimestamp` records in `attestations.timestamped_tx` (falls back to `merkle:<root>` when absent) | WP10 | open | `apps/web/src/lib/signing/attester.ts` |
| 62 | EAS GraphQL `attestation(where:{id})` shape and the Base endpoint used by the nightly reconciliation (`EAS_GRAPHQL_URL`; unset ⇒ findings are `unverified`, never `error`) | WP10/WP12 | open | `apps/web/src/lib/reconcile/index.ts` |
| 63 | Safe{Wallet} deep-link shape `app.safe.global/transactions/tx?safe=<prefix>:<addr>&id=multisig_<addr>_<safeTxHash>` and the `basesep`/`base` chain prefixes (the guardian screen's escape hatch) | WP10 | open | `apps/web/src/lib/treasury/safe-typed-data.ts` |
| 64 | api-kit 5.0.3 `confirmTransaction(safeTxHash, signature)` accepts a guardian's EIP-712 signature and rejects a non-owner's (the platform does not check ownership itself) | WP10 | open | `apps/web/src/lib/treasury/confirm.ts` |
| 65 | `bounties.prediction` JSON shape `{place_id, property, direction, window_end, window_start?}` (written by WP9, read by the nightly reputation job) | WP10 ↔ WP9 | open | `apps/web/src/lib/treasury/reputation.ts` |
| 66 | Hermes cron delivery webhook: whether v0.21.0 posts cron output to a URL at all, its body shape and whether it signs. The platform's contract is `POST /api/webhooks/hermes` with `X-Kami-Timestamp` + `X-Kami-Signature: sha256=<hmac over "<ts>.<raw body>">` (`HERMES_WEBHOOK_SECRET`, 5-minute window, `id` idempotency) and a body `{id, type:"cron.delivery", profile|slug, job, output, kami_guard?, usage?}`; a shim on the box may have to produce it | WP7 → T0.3 on the box | open | `apps/web/src/lib/jobs/hermes.ts` |
| 67 | `max_intersecting` (drought) and NWS-alert matching in the needs job are **bbox∩bbox**, not true polygon intersection: they can over-count where a concave watershed only shares a bounding rectangle with a polygon, never under-count. The twin MCP's `get_entity_status` does the finer centroid/vertex test on the same inputs; compare the two on the live tree before the phase-1 gate | WP7 ↔ WP1 | open | `apps/web/src/lib/jobs/geo.ts`, `readings.ts` |
| 68 | A geometryless (zone-only) NWS alert is matched by UGC zone from `config.entity_ugc.<slug>`, hand-seeded until the twin publishes `id/ugc.json` (TW-9). Confirm the zone list for each entity and switch to the twin's lookup when it ships | WP7 ↔ TW-9 | open | `apps/web/src/lib/jobs/readings.ts` `alertsFor` |
| 69 | `flood_category` is read from the anchor place page's `props.flood_category` (NWPS categories). The fixture tree carries no such key, so `flood_category` is `null` today — confirm the twin publishes it under that name, or agree another | WP7 ↔ WP1 | open | `apps/web/src/lib/jobs/readings.ts` `floodCategoryFor` |
| 70 | The platform MCP is mounted at `/api/mcp`; `profiles/templates/config.yaml.tmpl` points `mcp_servers.platform.url` at `{{platform_url}}/mcp`. Either set `PLATFORM_URL` to `https://<host>/api` at deploy time or add a `/mcp → /api/mcp` rewrite to `apps/web/src/proxy.ts` (diff in the WP7 report) | WP7 ↔ WP5 | open | `apps/web/src/app/api/mcp/route.ts` |
| 71 | `place/union-reservoir` (a member of the committed Boulder Creek binding) has no page in the twin fixture tree, so the nightly binding check reports it `missing` — the same will happen against the live tree if the slug guess is wrong (row 33) | WP7 ↔ WP2 | open | `apps/web/src/lib/jobs/__tests__/binding-check.test.ts` |
| 72 | R2 bucket for the platform's static tree: `R2_ACCOUNT_ID`/`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (default `entities-data`) and that R2 serves the object's `Cache-Control` verbatim on the public URL fronted by `KAMI_DATA_BASE_URL` | WP7 | open | `apps/web/src/lib/publish/r2.ts` |
| 73 | Vercel plan: the cron table in `infra/vercel.json` needs Pro (Hobby allows 2 day-granularity crons); and which directory Vercel reads `vercel.json` from for this monorepo | WP7 | open | `infra/vercel.crons.md` |
