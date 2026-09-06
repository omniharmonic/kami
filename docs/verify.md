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
| 12 | Better Auth 1.7 magic-link plugin; Neon Auth fallback | WP6 | open | better-auth 1.7.3 on npm |
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
