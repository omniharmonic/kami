# Handoff: the read-only MCP server, for the Front Range Bioregional Twin

**To:** whoever is working in `omniharmonic/frontrange-twin`
**From:** the Kami build (Benjamin Life, @omniharmonic)
**Date:** 2026-09-06
**Status:** ready to lift. The code is written, tested and waiting in the Kami repo.

---

## The short version

Kami needs one thing from the twin that does not exist yet: a **read-only MCP server over the published tree**, so an agent can ask the twin questions the way a browser asks it for files. That server is already written. It lives at `packages/twin-mcp/` in `omniharmonic/kami`, it is named `@bioregionaltwin/mcp` rather than `@kami/*` precisely because it belongs to you, and it imports nothing from Kami.

**The ask is a directory copy, a CI job, and an npm publish.** Everything else in this document is either optional or already done.

The reasoning is in Kami's `docs/adr/ADR-E15.md`: the contract belongs beside the publisher, but Kami could not wait for it, so it was built in a shape that moves without modification.

---

## What it is

A TypeScript MCP server that is a **pure function of the published tree**. It reads `https://data.bioregionaltwin.org` (or a local directory) over plain HTTP. It never touches the database, never contacts the compute host, and has no write path of any kind. It builds two ways from one codebase: an `npx @bioregionaltwin/mcp` stdio package, and a Cloudflare Worker.

Fifteen tools: `find_places`, `get_place`, `get_conditions`, `get_live`, `get_snow`, `get_health`, `get_boundary_summary`, `get_briefing`, `explain`, `list_entities`, `resolve_entity`, `get_entity_status`, `get_reading_history`, `get_alerts`, `compare_to_normal`.

Four resources: `twin://boundary/v1`, `twin://glossary`, `twin://licence`, `twin://about`.

It enforces, in code and in tests, the rules the twin already lives by:

- Every reading it returns carries `time`, `unit`, `source_id`, `stale`, `staleness_s`, `source_status`. Absent means unknown, never zero.
- **It honours both of your staleness dialects.** `latest/conditions.json` and `latest/snow.json` ship `stale` + `staleness_s`; the per-place pages ship `staleness_crit_s` and the client subtracts. `readingStaleness()` is ported from `web/src/data/reading.ts` exactly, including the rule that a reading with neither dialect is `unknown`, and unknown is never drawn as fresh.
- **No geometry ever leaves a tool.** `assertNoGeometry()` walks every output at every depth and throws on a `coordinates` key. Outputs carry `geometry_url`, `map_url`, centroids and bboxes at most. There is a contract test for this.
- Every output is ≤ 16 KB; lists paginate with `cursor` and `limit ≤ 50`.
- `flow_forecast` always comes back with `forecast: true` and the word "forecast" in its label.
- `latest/` is fetched with `If-None-Match` and a 60-second floor per path; `id/`, `geom/`, `boundary/` cache for 300 s. `User-Agent: bioregionaltwin-mcp/<version> (contact@bioregionaltwin.org)` — **that address is a guess; please correct it.**
- `compare_to_normal` returns `{available: false, reason: "twin publishes no baseline yet"}` and `get_briefing` returns `{available: false}`, because neither `normals/` nor `briefings/` exists yet. When they ship, both light up without a rewrite.

---

## What you actually have to do

### 1. Copy the directory

```
omniharmonic/kami/packages/twin-mcp/   →   omniharmonic/frontrange-twin/mcp/
```

Copy everything except `node_modules/` and `dist/`. The layout already matches what the architecture specified for `mcp/`:

```
mcp/
├── package.json            @bioregionaltwin/mcp 0.1.0
├── src/                    tree.ts, staleness.ts, envelope.ts, geo.ts, binding.ts,
│                           entity.ts, explanations.ts, server.ts, stdio.ts, worker.ts,
│                           resources.ts, hash.ts, readings.ts, twin.ts, tools/ (15 files)
├── schemas/                place-set-binding-1.0.json, facts-1.0.json, ids-schema-1.0.json
├── fixtures/               public/ (all-stale), public-live/ (fresh), bindings/
├── test/                   contract.test.ts + 7 more
├── scripts/                refresh-fixtures.ts, embed-schemas.ts, write-expected.ts
├── wrangler.jsonc          route commented out — nothing deploys by accident
└── README.md
```

Dependencies: `@modelcontextprotocol/sdk` 1.30.0, `ajv` 8.20.0, `ajv-formats` 3.0.1, `yaml` 2.9.0, `zod` 4.5.4. Node 22. Nothing else, and nothing from Kami.

### 2. Two things to change on arrival

- **`ids-schema-1.0.json` is a vendored copy of your `sources/ids-schema.json`.** Once it lives in your repo, read the original directly instead and delete the copy. There is already a test that asserts the two are byte-identical, which will start passing trivially — replace it with the direct read.
- **`explanations.ts` is a vendored copy of `web/src/copy/explanations.ts`**, generated to be byte-identical, carrying the CC BY-SA 4.0 attribution header. In your repo it should be generated at build time from the original rather than checked in, so it can never drift. `scripts/` has the pattern; there is a test asserting identity while the twin checkout is present.

### 3. Wire the CI job

```yaml
  mcp:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4          # before setup-node, per your existing ci.yml
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: pnpm }
      - run: pnpm --dir mcp install --frozen-lockfile
      - run: pnpm --dir mcp test            # 73 unit tests
      - run: pnpm --dir mcp test:contract   # 25 contract tests, ~2s, fixtures only
```

The contract suite runs entirely against the checked-in fixture tree, so it needs no network and no database — it will not slow your five-minute CI meaningfully. A nightly workflow running the same file against the live tree is worth adding separately; that one *will* fail when the tree changes shape, which is the point.

**A warning from our side:** we had this exact job filtering a package name that did not exist. pnpm treats "no packages matched" as success, so it was green for days without running anything. Check that the job actually reports 25 tests.

### 4. Publish

`npm publish` under the twin's org, then Kami pins `^1` and deletes its local copy. Until then Kami consumes it through the workspace, which works but means the contract lives in two places in spirit.

### 5. Deploy the Worker (optional, and yours to decide)

`wrangler.jsonc` targets `mcp.bioregionaltwin.org` with the route commented out. **One blocker if you do:** `ajv` compiles schemas with `new Function`, which Workers forbid. Only the `resolve_entity` path with a `binding_url` argument hits it; swap `@cfworker/json-schema` there first. The stdio package is unaffected. Also verify the Workers rate-limiting binding is available on your plan — the in-memory token bucket in the code is per-isolate and therefore not a real limit.

---

## What Kami needs from the tree, ranked

None of this blocks the MCP server. It all makes the first entity better, and the first two are the ones that turn a card that *can* be built into one whose most meaningful cells are real. These correspond to TW-1 … TW-11 in Kami's implementation plan.

| Priority | What | Why Kami wants it | Size |
|---|---|---|---|
| **1** | **CORS on the R2 bucket** (`GET, HEAD`, expose `ETag`) | The browser fetches `geom/*.geojson` directly for the map. Your commons handoff verified CORS on the publication API, not on R2. | minutes |
| **2** | **Document the tree as the API** on `/about` | It already is the API. Kami's client was written from a code survey rather than documentation, which is a fragile way to depend on someone. | copy only |
| **3** | **Baselines** — `normals/{ns}/{slug}.json` plus the per-reading `context` block | **This is the big one.** Without a percentile an entity cannot say "low for September" — it can only say a number and a trend, and it currently says so explicitly and a little sadly. This is the single change that most improves what a kami can honestly tell someone. Your enrichment proposal §3.1 already specifies the shape; Kami reads exactly that shape and stays blocked until it exists. | needs a CDSS key |
| **4** | **Stream places** — `place/<stream>` with `children[]` = main-stem gauges, `props.reach_ids[]`, a GNIS `sameAs` | Boulder Creek has no twin id today, so a creek entity is bound to a hand-frozen list of gauges guessed by name matching. A real id makes the binding an assertion of yours rather than a guess of ours. `core.place_kind` already contains `stream_reach`, so this may need no enum change and no Prism coordination. | 2–4 d |
| 5 | `id/ugc.json` — a UGC → county lookup | Zone-only NWS alerts have null geometry. Kami currently matches them through a hand-maintained config key per entity, which will rot. | 1 d |
| 6 | Watershed rollups on `latest/watershed/*.json` | Kami re-aggregates `conditions.json` on every pulse to get what a rollup would hand it. Works; wasteful. | 2–3 d |
| 7 | `twin/briefing.py: facts_for(place_ids, tree)` emitting `facts-1.0.json` | One fact-sheet schema, two emitters, one matcher. Kami's `factguard` (Python) is offered upstream for your weekly briefing's numeric guard — it is the same problem, already solved and tested. | 2 d |
| 8 | A separate revocable Parachute token and an `entities` vault | Kami writes its own prose — entity pages, weekly state, quarterly memos — and should not touch the civic commons' token or pollute its vault. | 0.5 d + a conversation |

---

## Things we got wrong, or could not check

Please treat these as questions, not assertions.

- **The `User-Agent` contact address** `contact@bioregionaltwin.org` is invented. Correct it.
- **Our sandbox could not reach `data.bioregionaltwin.org` at all**, so every fixture in `mcp/fixtures/` is synthetic — generated from your checked-in `web/src/__fixtures__/conditions.json` plus hand-authored records. The shapes come from reading `twin/publisher/build.py` and `web/src/data/types.ts` closely, and the survey that informed them is at `docs/research/twin-survey.md` in the Kami repo with line-level citations. **The first thing worth doing after the copy is `pnpm --dir mcp run refresh-fixtures` against the live tree**, then re-running the contract suite. If it fails, the fixtures were wrong, not the tree.
- **HUC codes in the fixtures are made up.** More importantly: our survey found Orodell's live `huc12` is `101900050301`, which sits under HUC-10 `1019000503` — but the architecture's Boulder Creek binding lists `…0504` through `…0507`. One of those is wrong and we cannot tell which from here. It is recorded as row 32 in `docs/verify.md`.
- **Five place ids in the Boulder Creek binding are slug guesses** from the PRD's worked example: `place/lake-eldora`, `place/university-camp-2`, `place/union-reservoir`, `place/leggett-valmont-reservoir`, `place/six-mile-reservoir`. If any is wrong the binding validator will reject it loudly, which is the correct behaviour but an annoying way to find out.
- **Whether your CI can build `public/`** for the contract tests instead of shipping a pruned fixture tree. If it can, that is strictly better and the fixtures can go.

---

## How to check it works

```bash
# from the twin repo, after the copy
pnpm --dir mcp install
pnpm --dir mcp test            # 73 pass
pnpm --dir mcp test:contract   # 25 pass, fixtures only

# against the live tree — the moment of truth
pnpm --dir mcp run refresh-fixtures
pnpm --dir mcp test:contract

# drive it by hand
npx @bioregionaltwin/mcp --tree https://data.bioregionaltwin.org \
  --binding mcp/fixtures/bindings/boulder-creek.yaml
```

The last command should answer `get_entity_status` in under two seconds warm, with six needs, each carrying its five honesty fields, and a `snapshot_hash` that does not change when only `generated_at` does.

---

## The one line that matters

Kami reads the twin exactly as a browser does and never writes to it. There is no database link, no shared library beyond this package, no request to the compute host, and no write path anywhere in the design. If this server ever grows one, something has gone wrong upstream of the code.
