# Beings.earth product audit

2026-09-06. The latest product direction supersedes the old Kami product naming: **beings.earth** is the platform; **Kami** is its mascot and guide. Package names and entity IDs can remain stable.

## What the existing build actually supports

The repository implements place-bound entities, a saved five-step summon flow, public needs and pulses, public strategies, a bounty/evidence/evaluation pipeline, human-controlled treasury interfaces, reputation, consultation gates, and read-only twin integration contracts. README and STATUS explicitly distinguish synthetic tests from external integration proof. Their claim that implementation packages are complete does not establish launch readiness.

The critical experience problem is that functional pieces were presented primarily as forms and technical tables. Visitors need a landscape, visible beings, a welcoming introduction, an interactive habitat, and a clear transition from wonder into measured evidence and real participation.

## Priority findings

| Finding | Product consequence | Required next step |
|---|---|---|
| README and STATUS say no real model has spoken; tests use a fake gateway. | A passing suite does not prove a working agent. | Configure an actual gateway, exercise a sourced conversation, then run the live guard probe and pause drill. Keep offline/sample states explicit. |
| Twin MCP is being completed in its upstream repository. | Live sensing depends on the published contract and availability. | Verify index, latest readings, staleness, attribution, errors, and binding proposals against the handed-off server. Never substitute invented readings. |
| Place search discovers kinds dynamically, but binding proposal logic primarily matches watersheds and monitoring sites. | Finding a forest or animal record does not prove that creating its entity works. | Extend and test binding semantics against real upstream animal/community/habitat IDs. Preserve sensitivity gates. |
| Avatar rigs cover creek, mountain, reservoir, watershed, and bioregion. | Avatar appearance is not the same thing as ecological entity type. | Keep those contracts separate; add new creature appearance options with safe fallback and established input contracts. |
| No arbitrary polygon binding authoring path is evident in the current summon experience. | The drawn habitat vision remains unfinished. | Build geometry selection as a human-facing workflow; resolve public twin IDs server-side, validate coverage and sensitivity, and keep coordinates out of tool/model outputs. |
| Multiple beings can share an anchor and the summon flow surfaces siblings. | Plurality is already supported. | Make sibling voices discoverable on the map and in habitat dashboards. |
| Strategy and periodic jobs exist, but live strategy refinement is not established by fake-backed tests. | Public learning needs evidence, not animated claims. | Show published strategy, hypothesis, evaluation, and revision history with dates and evidence; exercise the real recurring pipeline. |
| Coalitions and shared treasuries are not implemented. | This is a meaningful future capability. | Design coalition membership, explicit contribution approvals, shared proposal accountability, withdrawal rules, and public receipts before introducing financial actions. |
| Model provenance and model gateway exist, but user-selectable models per task are not established. | Chat and long-running reasoning cannot yet be advertised as independently configurable by users. | Define validated task-specific routing, budgets, availability, and model provenance; preserve fact guarding on every route. |
| External Safe, payment, auth, and model integrations lack launch proof in STATUS. | A visually complete UI must not imply operational settlement or production readiness. | Follow first-entity runbook using actual services and publish the resulting evidence. |

## Implemented within this audit's scope

The summon entry now introduces Kami as the guide, uses an original leaf-eared sprite illustration with reduced-motion support, establishes the beings.earth identity, explains the five steps in human language, and displays a code of care. Saved drafts, authentication, place choice, earned cosmetics, guardian requirements, optional funding, consultation, and publication actions retain their existing backend contracts. A scoped layout supplies a consistent light botanical surface across the complete summon flow without changing global styles.

The code of care emphasizes good-faith ecological wellbeing, Indigenous sovereignty, more-than-human perspectives, transparency, and human responsibility. It is guidance displayed before creating a draft; it does not pretend to add a new persisted consent gate.

## Acceptance checks still needed

- **Completed locally:** browser review at mobile and desktop widths, keyboard navigation, focus visibility, reduced motion, and automated accessibility checks (results below).
- **Verify:** real account → saved draft → twin-backed binding → accepted guardians → consultation → publication.
- **Verify:** real model answer with cited current-turn evidence, a stale input, an unsupported question, and a guardian pause.
- **Verify:** human-approved payment settlement and public outcome receipt against an actual configured Safe.

The outstanding verification items describe external evidence still needed; they are not claims of passing production checks. See `docs/verify.md`, `docs/STATUS.md`, and `docs/deploy/first-entity.md` for the existing launch evidence backlog.

## Implementation pass: landscape and backend

The landing experience now fills the viewport with a procedurally rendered Three.js alpine landscape, original animated sprites, habitat filters, zoom, a being picker, and a written interactive Kami introduction. Native modal dialogs open scenic habitat visits, senses, and stewardship. Published entities use the existing guarded chat relay, status readings, strategy, and pulse components within that dialog. Full observatories retain proposals, bounties, treasury, reputation, guardian, and connection workflows and now include a scenic habitat header. Mobile layouts, reduced motion, keyboard controls, native modal focus management, and an SVG fallback are included.

The landscape is an illustration, not the twin's geographic DEM. The twin's atmospheric direction informed lighting; this does not claim its geographic pipeline was ported. Uncreated forest and wildlife homes are explicitly previews with unknown readings, not invented published entities. Preview habitats cannot start a fake entity chat. No live ecological, financial, or model availability claim follows merely from seeing a sprite.

Backend repairs:

- Per-stream UTF-8 decoder prevents concurrent chat corruption; CRLF frames and a final unterminated frame preserve reminder ordering.
- Request cancellation reaches the gateway while retaining its timeout; HTML login pages cannot masquerade as SSE.
- Unpublished entities require preview authorization on chat as well as their pages.
- Staging deliveries cannot enter production records; paused and retired entities reject late cron output.
- Strategy drafts follow the configured comment period.
- An unset model gateway is asleep. Canned replies require explicit `fake:` configuration.
- EXIF camera timestamps use the existing deterministic normalization rather than the server's local timezone.
- Shared package builds use package names so a checkout path containing parentheses does not silently omit packages.

Verification: the final web suite passed all **776 tests across 86 files**, including explicit gateway configuration fixtures and the missing-gateway regressions. Evidence tests pass in the local America/Denver timezone after the EXIF fix. Production build and TypeScript checks passed. Desktop and phone browser review covered terrain, opening habitats, explicit missing senses, and the actual chat composer. The new Playwright exploration tests cover filters, preview honesty, published readings, modal closing, and the guide. Final browser suite outcome is recorded in the session's delivery report.

External work remains: real twin MCP handoff, model connection plus live guard/pause evaluation, actual payment settlement, forest/species binding semantics, polygon authoring, task-specific model routing, and coalition treasuries. These are not represented as completed capabilities.

The final accessibility pass corrected light-theme stale chips, secondary text contrast, and 44px exploration controls. The landing registry now resolves at request time, avoiding a build-time empty list persisting into a configured deployment. Entity habitat sprites follow the same snapshot mood as the original avatar. Existing reduced-motion tests remain focused on the Rive avatar; the new terrain renderer respects the motion preference independently.

Final browser verification: **58 passed, 1 skipped**. The skipped test is the existing proposal-detail route that requires a database bounty row, absent from the fixture harness. All three axe page checks and the phone touch-target checks passed. The final production build completed successfully after connecting scene mood to its snapshot.
