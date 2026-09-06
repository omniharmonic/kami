# ADR-E15 — The twin MCP package is developed in the Kami repo and lifted upstream unchanged
**Status:** accepted for build (2026-09-06)
**Context.** ADR-E10 places the read-only MCP server and its schemas in `frontrange-twin/mcp/` because the contract belongs beside the publisher. This build session has read access to the twin repo and write access only to the Kami repo, and the platform cannot wait for the twin's `feat/mcp` branch to land.
**Decision.** `packages/twin-mcp` in this repo is laid out exactly as `frontrange-twin/mcp/` will be (`package.json` named `@bioregionaltwin/mcp`, `src/`, `schemas/`, `fixtures/public/`, `test/contract.test.ts`, `wrangler.jsonc`, `README.md`), imports nothing from `@kami/*`, and reads the tree only through URLs or a `--tree` directory. Kami depends on it through the workspace as `@bioregionaltwin/mcp`. Moving it upstream is a directory copy plus a PR against the twin; once published to npm, Kami pins `^1` and deletes the local copy.
**Consequences.** (+) Kami has a real contract to build against today. (+) The upstream PR is mechanical. (−) Until the move, the contract lives in two places in spirit; the package's own contract tests keep it honest. (−) The Worker deployment is the twin operator's, not Kami's; `wrangler.jsonc` is checked in but never deployed from this repo.
**Alternatives rejected.** Opening a PR against the twin from this session (out of scope for the designated branch); putting the tools inside `apps/web` (wrong owner for the contract).

## Build notes

_None yet._
