# Kami — engineering conventions

Read `README.md` first (the five rules). Then the planning docs in `docs/planning/`: `01-PRD.md` (what), `02-technical-architecture.md` (how; the authority when the two disagree), `03-implementation-plan.md` (task-level detail). `docs/research/twin-survey.md` documents the twin's published tree shapes with citations — build fixtures from it.

## Naming
- The product is **Kami**. Package scope `@kami/*`. Entity ids are `entity/<slug>`. "Ecological Entities" in the planning docs = Kami. An individual entity may be called "a kami"; the disclosure copy always says "an AI voice **for** <place>".
- Attribution: Benjamin Life (@omniharmonic). Never attribute to OpenCivics.

## Workspace
- Node 22, pnpm 10 (`packageManager` pinned), TypeScript 5.9 strict, Vitest 3. Python ≥3.11 with `uv` workspace (`apps/gate`, `packages/factguard`, `packages/treasury-mcp`, `evals`), pytest.
- Every TS package: `package.json` with `"name": "@kami/<name>"`, `"type": "module"`, scripts `typecheck` (`tsc --noEmit -p tsconfig.json`), `test` (`vitest run`), optional `build`; `tsconfig.json` extends `../../tsconfig.base.json`; source in `src/`, tests in `test/` or `src/**/*.test.ts`.
- Every Python package: `pyproject.toml` with hatchling, `src/` layout or flat package, `tests/`.
- Pinned versions (Sept 2026): next 16.3.4, react 19.2.8, drizzle-orm 0.45.2, drizzle-kit 0.31.10, better-auth 1.7.3, @modelcontextprotocol/sdk 1.30.0, viem 2.56.3, @safe-global/protocol-kit 8.0.6, @safe-global/api-kit 5.0.3, @ethereum-attestation-service/eas-sdk 2.10.0, @rive-app/react-canvas 4.34.1, stripe 22.6.1, resend 6.26.0, zod 4.5.4, @playwright/test 1.63.0, exifr 7.1.3, @electric-sql/pglite 0.5.8, ajv 8.20.0, yaml 2.9.0. Python: mcp 2.1.1, starlette 1.6.0, httpx 0.28.1, uvicorn 0.52.4, pydantic 2.13.5, pyyaml 6.0.3, pytest 9.1.1.
- Network: the sandbox can reach npm and PyPI but **cannot reach `data.bioregionaltwin.org`**. Never make tests depend on the live tree; use `packages/twin-mcp/fixtures/public/`.
- No Docker daemon, no GPU, no Postgres server in the sandbox. Database tests use `@electric-sql/pglite`; gate tests use an in-process fake upstream.

## Invariants every package must respect
- Every reading crossing any boundary carries `time, unit, source_id, stale, staleness_s, source_status`. Absent means unknown, never zero. Nothing is interpolated.
- `stale` on a driving need forces `mood: asleep`. Never distressed.
- No geometry (no `coordinates` key) ever enters a tool output or a model prompt.
- Numbers the model utters must match an atom from a tool result of the same turn (`factguard`).
- No secret in `NEXT_PUBLIC_*`, a commons note, a status file, or a profile directory. No chain key on the GPU box or in `profiles/`.
- The agent never signs. The treasury MCP has exactly three tools and no signing dependency.
- Disclosure ("I'm an AI voice for <name>, built on public sensor data — not the <kind>, not a legal person") is rendered by layout, not by prompt.
- Copy lives in one `copy/` module per app. English only. No urgency language in donation copy. No token, ever.

## Working in this repo (agents)
- You own only the paths named in your task. Do not edit other packages' sources; if you need an interface change, write it in your report.
- Do **not** run `git commit` or `git push` — the orchestrator commits. Do not delete or rewrite files you did not create.
- Run your package's tests before reporting. Report: files created, commands run, test output summary, open questions, and any deviation from the planning docs.
- Mark anything unverified with *verify* and add it to `docs/verify.md`.
