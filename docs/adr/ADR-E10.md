# ADR-E10 — Separate repo; the twin publishes the MCP package and the contract tests

**Status:** accepted for build (2026-09-06)
**Context.** B1 §7: nothing in `twin/` would be imported except the MCP wrapper; a monorepo means a uv workspace, a pnpm workspace, a second compose project and doubled CI. The twin's PRD line is "coupled by exactly one ID string and one JSON schema."
**Decision.** Two repos. `frontrange-twin` gains `mcp/` — one TypeScript codebase built two ways: an `npx @bioregionaltwin/mcp` stdio package and a Cloudflare Worker — plus `mcp/schemas/place-set-binding-1.0.json` and `mcp/schemas/facts-1.0.json`, and a contract test job in `.github/workflows/ci.yml`. The platform repo (`ecological-entities`) pins the package by semver and re-runs the contract tests against its pinned version in its own CI. The coupling surface is: `sources/ids-schema.json`, the two MCP schemas, the tool contract (§4), and the published tree.
**Consequences.** (+) The twin's CI stays ~5 min. (+) The twin never learns the platform exists. (−) TypeScript, not Python, for the wrapper (B1 offered either); the twin's Python briefing generator and the TS wrapper share a *schema*, not code (§15).
**Alternatives rejected.** Monorepo (B1 §7 costs); MCP in the platform repo (the contract belongs beside the publisher).

## Build notes

_None yet._
