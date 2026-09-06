# @bioregionaltwin/mcp

A read-only [MCP](https://modelcontextprotocol.io) server over the Front Range
Bioregional Twin's published tree (`https://data.bioregionaltwin.org`). It is a pure
function of static files: no database, no origin server, no write path. It reads the
tree exactly as a browser does and turns it into fifteen tools an agent can call
without ever seeing a coordinate.

This package is **the contract** between the twin and anything that senses through it
(architecture §4). It is developed in the Kami repo and lifted verbatim into
`frontrange-twin/mcp/` (ADR-E15).

```
npx @bioregionaltwin/mcp --tree https://data.bioregionaltwin.org --binding boulder-creek.yaml
```

Flags: `--tree <https-url | local dir>` (default the public tree; env `TWIN_TREE`),
`--binding <file.yaml|json>` (repeatable; validated on load, refused on error),
`--contact <address>` (goes in the `User-Agent`), `--allow-binding-origin <origin>`
(repeatable; where `resolve_entity` may fetch a `binding_url` from).

Programmatic: `import { createServer, runTool, TreeReader, validateBinding } from "@bioregionaltwin/mcp"`.
Schemas ship under `@bioregionaltwin/mcp/schemas/*`.

## Tools (contract 1.0)

Every result is JSON text in the envelope `{ as_of, schema_version, tree_generated_at, ...payload }`.

| Tool | Input | Returns | Reads |
|---|---|---|---|
| `find_places` | `{query?, kind?, huc?, bbox?, cursor?, limit?}` | `{places:[{id, kind, name, huc12, bbox}], total, next_cursor}` | `id/index.json` |
| `get_place` | `{id, series?}` | identity record + `readings[]` (stale computed from `staleness_crit_s`) + `series_summary{min,max,last,trend,n}` per datastream + `points_url`, `children`, `parent_id`, `superseded_by`, `commons_url`, `sameAs`, `geometry_url` | `id/<id>.json`, `latest/<id>.json` |
| `get_conditions` | `{place_ids?[] \| huc? \| within?, cursor?, limit?}` | `{stations:[{id,name,huc12,readings[]}], sources}` — `within` is point-in-polygon server-side | `latest/conditions.json`, `geom/` |
| `get_live` | `{layer, within?, cursor?, limit?}` | features' **properties + centroid + bbox**; zone-only alerts `geometry: null, matched_by: null`; drought carries `dm, label, period_start, period_end` | `latest/<layer>.geojson`, `geom/` |
| `get_snow` | `{}` | `{snowline_m, opacity, basis[], rule, stale}` | `latest/snow.json` |
| `get_health` | `{}` | the honesty board | `latest/health.json` |
| `get_boundary_summary` | `{version?}` | `{id, boundary_version, area_sqkm, huc8[], method, rationale (600 chars), rationale_url, geometry_url}` | `boundary/v1.*` |
| `get_briefing` | `{date?}` | `{available:false, reason}` until `briefings/` ships | `briefings/latest.json` |
| `explain` | `{property, value?}` | `{label, short, long, unitHelp, bands?, band?, license:"CC BY-SA 4.0", attribution}` | vendored table |
| `list_entities` | `{}` | stdio: the configured bindings; Worker: `{entities: []}` | `--binding` |
| `resolve_entity` | `{query}` | a validated binding from a configured slug, a twin watershed/stream id (proposal, `binding_version: 0`), or an allowlisted `binding_url` | binding + `id/` |
| `get_entity_status` | `{entity?}` | **the pulse**: `needs[]`, `live{drought_max_dm, alerts, fires_inside, detections_24h}`, `sources`, `snapshot_hash`, `facts` (facts-1.0) | everything for the binding |
| `get_reading_history` | `{place_id, property, window: 24h\|7d}` | `{summary{min,max,last,trend,n}, points_url}` — never raw points | `latest/<id>.json` |
| `get_alerts` | `{entity?}` | `{alerts:[{kind: nws\|drought\|fire\|air, headline, severity, until, place_ids[], url, matched_by}]}` | live layers + binding |
| `compare_to_normal` | `{place_id, property, date?}` | `{available:false, reason:"twin publishes no baseline yet", record_start?}` until `normals/` or a `context` block exists | place page |

Resources (`ttlMs` 300 000): `twin://boundary/v1`, `twin://glossary`, `twin://licence`, `twin://about`.

## Rules the server enforces

- Every reading carries `time`, `unit` (UCUM), `source_id`, `stale`, `staleness_s`, `source_status`. Absent means unknown, never zero; nothing is interpolated.
- Two staleness dialects, resolved threshold-then-flag exactly as the twin's client does: `latest/conditions.json` and `snow.json` ship a verdict (`stale`, `staleness_s`), per-place pages ship the threshold (`staleness_crit_s`) and the server computes against its clock. A reading with neither is `staleness_unknown: true` — unknown is not fresh. The seed thresholds in `src/staleness.ts` are a last resort only.
- `source_status` answers "is the feed up?" (the health board's verdict); `stale` answers "is this value fresh?". They differ on purpose — a live reservoir reading on a critical feed is a real state.
- `flow_forecast` is returned with `forecast: true` and a label containing "forecast".
- **No geometry ever enters a tool output**: `assertNoGeometry` throws on any `coordinates` key or GeoJSON geometry object. Outputs carry `geometry_url`, centroids and bboxes at most. Point-in-polygon and polygon overlap run server-side (ray casting; overlap is bbox + vertex/centroid containment, documented as an approximation in every `live` block).
- Every output ≤ 16 KB (`assertSize`); lists paginate with `cursor` + `limit ≤ 50`, shrinking a page to fit.
- Reads: `If-None-Match`, in-memory cache per path, `ttlMs` 60 000 for `latest/**`, 300 000 for `id/ geom/ boundary/`, 3 600 000 for `network/`; a 60 s floor per path against a remote tree; 404 → `null` (superseded, withdrawn, unpublished — a state, not an error); stale-if-error. `User-Agent: bioregionaltwin-mcp/<ver> (contact@bioregionaltwin.org)` (*verify* the address).
- A binding is validated against `schemas/place-set-binding-1.0.json` and rules 1–6 on load: ids match `^[a-z_]+/[a-z0-9-]+$` and exist in `id/index.json`; every `id/<id>.json` validates against the vendored `ids-schema-1.0.json`; role constraints against `latest/conditions.json` datastreams; sensitivity `public|generalized` and no boundary geometry from a `generalized` place; consistency warnings (member outside the watersheds, need with no reading today); `agg` enum. The stdio server refuses to start on an error.
- `snapshot_hash` = sha256 over the members' readings with `generated_at` and `staleness_s` removed at every depth — the pulse's "did anything change" key.
- `get_entity_status.facts` conforms to `schemas/facts-1.0.json` (byte-identical to `packages/facts-schema/facts-1.0.json`; one schema, two emitters, one guard).

## Versioning and deprecation

Semver on the package. `tools/list` returns `_meta.contract_version` (`1.0`), on the result and on every tool. Additive changes (a new optional field, a new tool) are minor. Removing or renaming a tool or field is major, preceded by ≥ 90 days with `deprecated: true` and a `replaced_by` in the tool's `_meta` and description. The envelope carries the tree's `schema_version`, so a tree change surfaces as data, not as a crash. Consumers pin `^1` and run `test/contract.test.ts` against their pinned version in CI.

## Transports

- **stdio** (`dist/stdio.js`): `McpServer` + `StdioServerTransport` from `@modelcontextprotocol/sdk` 1.30.0.
- **Worker** (`src/worker.ts`, `wrangler.jsonc`): the same SDK's `WebStandardStreamableHTTPServerTransport` in stateless mode (`sessionIdGenerator: undefined`, one transport per request, JSON responses), tree fetches with `cf: { cacheTtl }`, a per-IP token bucket (60/min anonymous, 600/min with a valid `X-API-Key`; keys are the twin operator's) and `/healthz`. The bucket is an in-memory Map per isolate; a Workers Rate Limiting binding (`RATE_LIMITER`) replaces it when configured (*verify* plan availability). Route `mcp.bioregionaltwin.org` is commented out in `wrangler.jsonc`; nothing is deployed from the Kami repo.
- **Why SDK 1.30 and not `@modelcontextprotocol/server` 2.0:** the 1.30 SDK already ships a Web-standard Streamable HTTP transport that runs on Workers, matches the version pinned across this monorepo, and is what the stdio build uses — one codebase, two entries. The 2.0 package (spec 2026-07-28, `ttlMs`/`cacheScope` per list) is on npm but was not adopted here; revisit when the twin publishes (*verify*). Note that `ajv` (used to validate bindings and id records) compiles schemas with `new Function`, which Workers forbid; the Worker paths that need it (`resolve_entity` with a `binding_url`) should swap in `@cfworker/json-schema` before deployment (*verify*).

## Fixtures and tests

`fixtures/public` is an all-stale 2026-09-06 build; `fixtures/public-live` the same tree fresh; `fixtures/bindings/boulder-creek.yaml` is architecture §3. Regenerate with `pnpm refresh-fixtures` (needs the twin checkout at `$TWIN_REPO`, default `/home/user/frontrange-twin`). See `fixtures/README.md` for what is real and what is synthetic.

```
pnpm typecheck          # tsc, src + test + scripts
pnpm test               # everything (tree, staleness, explain, worker, stdio smoke, tools, schemas, contract)
pnpm build              # tsc → dist/ (dist/stdio.js is the bin)
pnpm test:contract      # architecture §4.3 only
```

Never test against the live tree from CI; the nightly contract run against `https://data.bioregionaltwin.org` is a separate workflow in the twin repo.

## How to lift this into `frontrange-twin/mcp/`

1. Copy `packages/twin-mcp/` to `frontrange-twin/mcp/` as is. Nothing here imports `@kami/*`; the only external inputs are the tree URL/dir and binding files.
2. Point `scripts/refresh-fixtures.ts --twin ..` at the repo root (it reads `web/src/__fixtures__/conditions.json`), and make `scripts/embed-schemas.ts` read `sources/ids-schema.json` directly instead of the vendored copy.
3. Add a `mcp` job to `.github/workflows/ci.yml`: `pnpm --dir mcp install --frozen-lockfile && pnpm --dir mcp typecheck && pnpm --dir mcp test`, plus a nightly job running `test/contract.test.ts` with `TWIN_TREE=https://data.bioregionaltwin.org`.
4. `web/package.json`: add a `vendor-explanations` step that regenerates `src/explanations.ts` from `web/src/copy/explanations.ts` (the test `explain.test.ts` asserts byte-identity of the table when the web source is present).
5. Publish `0.1.0` to npm under the twin's org; deploy the Worker with `wrangler deploy`; submit to the MCP registry. Kami then pins `^0.1` and deletes its local copy.

## Licences

Code: **Apache-2.0**. The explanations table in `src/explanations.ts` is vendored prose from `frontrange-twin/web/src/copy/explanations.ts`, © Front Range Bioregional Twin contributors, **CC BY-SA 4.0** — every `explain` result carries the licence and attribution, and redistributing this copy requires both. The twin's structured facts are CC0; per-source licences ride on the health board, and a `cc-by-nc` source (PurpleAir) is never blended into a CC0 aggregate.
