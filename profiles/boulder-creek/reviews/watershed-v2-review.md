# Boulder Creek: broader connected watershed — reviewed v2

Status: **approved and installed on 2026-09-07** following the steward’s explicit approval in the setup session. Production now points to approved binding v2, with 12 places and five need mappings. The being remains private and paused; consultation and public representation were not authorized. Approval time: `2026-09-07T18:09:46.880Z`. The production audit chain verified after installation. The companion proposed JSON preserves the exact candidate that was reviewed; the installed binding additionally records the steward’s account ID in `reviewed_by`.

## Proposed scope

Keep the four published HUC-10 areas: Headwaters Boulder Creek, South Boulder Creek, Coal Creek–Boulder Creek, and Boulder Creek–Saint Vrain Creek. This is a working catchment envelope, not a claim that every feature inside it contributes to Boulder Creek or that its entire area is monitored.

The companion `binding-v2.proposed.json` contains **12 places**:

| Relationship | Retained places | Interpretation |
|---|---|---|
| Main-stem observations | Orodell, Broadway, North 75th Street, mouth | Four separate longitudinal observations. Do not average or sum discharge across successive gauges. |
| Mountain snow context | Niwot, Lake Eldora, University Camp | Point snowpack measurements, not watershed-wide snow totals. Niwot and University Camp share a HUC-12 but have distinct published elevations (3029.71 and 3148.58 metres); this supports retaining distinct observation sites, not weighting or extrapolating their coverage. |
| Connected reservoir context | Gross, Leggett-Valmont, Six Mile | The published water-source fields identify South Boulder Creek for the first two and Boulder Creek for Six Mile. This does not establish daily operational flows, return flows, or reservoir-wide causation. |
| Tributary water quality | South Boulder Creek forebay | Local tributary observations. Never describe them as measured Boulder Creek main-stem water quality. |
| Nearby air context | Boulder CU / Athens Street | Local air observations, not a direct measurement of creek health. |

**Defer Union Reservoir.** It is inside the selected downstream HUC-10 envelope, but its published water-source field says Saint Vrain Creek. Geographic inclusion alone does not prove a functional Boulder Creek connection. Its record remains in the evidence file; restore it only with a documented relationship or a separately labelled regional comparison scope.

## Exact proposed need mappings

| Need | Input | Aggregation | Limit |
|---|---|---|---|
| Flow | Orodell discharge | Single anchor reading | Orodell's flow context, not whole-watershed flow. Other gauges remain available for separate comparisons. |
| Snow | Niwot SWE | Single station | Site-specific snowpack. Lake Eldora and University Camp remain contextual observations; no unreviewed spatial snow model. |
| Water | Forebay dissolved oxygen | Single station | South Boulder Creek tributary context only. |
| Air | Boulder CU PM2.5 | Existing 24-hour mean contract | Requires appropriate data support; do not substitute a latest reading or duplicate AQI entries for a mean. |
| Drought | Published drought polygons intersecting the four HUC-10 areas | Maximum intersecting class | Presence of the worst intersecting class, not uniform drought over the entire scope. |

**Withhold the storage need in this draft.** Version 1 drives it solely from Gross Reservoir's derived fill. The reviewed Gross storage timestamp is from 2021 and derived-fill source status is unknown. Reservoir observations stay in the body and remain inspectable with their timestamps and caveats; they are not dropped to manufacture a healthier mood. A storage assessment needs a reviewed source, capacity definition, freshness rule and interpretation before becoming a driving need.

All retained driving needs keep the existing staleness rules. Missing stays unknown; stale input can still make the being asleep. No new baseline, normal range, interpolation, or causal claim is introduced. Gauge height/stage and duplicate AQI records are not added as competing needs; raw sources stay distinct during inspection.

## Remaining coverage limits

- Direct main-stem water quality, diversion/return-flow observations, creek-corridor weather, and explicit Coal Creek sensing need a separate discovery review. The current list is not exhaustive.
- A fresh reading does not imply a baseline exists. Only quote a baseline returned for that site/property/time.
- Neither the reservoir water-source labels nor catchment polygons prove operational connectivity or flow timing.
- This membership is a proposed starting body, not a finished scientific watershed model.

## Evidence and next step

`watershed-v2-evidence.json` records the published twin responses consulted on September 7, 2026, including source timestamps, parent catchments, readings and public page URLs. It omits geometry. Refresh observations before making current-condition claims.

The 12-place membership and five need mappings were approved together. The first needs job stored snapshot 1 at `2026-09-07T18:09:47.140Z`; publication was withheld because consultation is incomplete. A real OpenAI-backed Hermes turn retrieved approved v2, its snapshot, and the public Orodell gauge. It identified stale snow separately from the paused state and kept the anchor distinct from the broader watershed. The local `beings-earth` profile was refreshed to the installed binding.

The original `profiles/boulder-creek/binding.yaml` remains the v1 fixture baseline used by regression tests. It is not the current production configuration. Download the authenticated connection bundle for the exact current binding, including its review metadata.
