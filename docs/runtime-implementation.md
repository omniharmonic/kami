# Guarded Hermes runtime implementation

> **Current publication policy (September 7, 2026):** Consultation is encouraged as a being grows and is never required for setup, publication, chat or grant rounds. `entities.published_at` independently controls public visibility. Consultation records remain truthful and optional; publishing does not mark consultation complete. Guardian approval, spending safeguards and sensitive-data rules remain unchanged. Any older consultation-gate descriptions below are historical and superseded.

Implemented September 7, 2026. These adapters are tested locally; deployment and live model verification are separate acceptance steps.

## Process boundary

Website relay → authenticated fixed-slug router (`8643`) → dedicated Hermes AIAgent harness (`8642`) → entity-gate (`8001`) → OAuth bridge (`8002`) → OpenAI Codex.

Every model round uses the gate's `/p/<slug>/v1` Chat Completions endpoint. The bridge uses the installed Hermes `ResponsesApiTransport` to preserve tool continuation IDs while converting to Responses, resolves and refreshes credentials through Hermes's auth store, and emits incremental text, function arguments and actual usage. No OAuth token is copied into a profile or repository. The bridge only accepts loopback requests with a separate 32-character-or-longer key, pins the model, and refuses credential endpoint overrides. Incomplete/provider-error streams do not emit a successful DONE.

The harness constructs AIAgent with an explicit custom Chat Completions endpoint, disables provider fallback, context files, memory and trajectory output, and verifies the resulting transport before invoking the model. MCP discovery finishes before accepting requests. Tool handlers strip geometry and credential fields before results reach the model, including JSON embedded in MCP text envelopes. The actual completion callback creates a source footer containing IDs, times, source IDs and stale flags; no raw arguments or tool results reach the browser. Website chat exposes read-only platform tools. Steward proposal/strategy work continues through an authenticated steward client; a website visitor is not authorized to exercise its credential's write powers.

The router checks platform-synchronized gate pause state before invoking Hermes, rejects unknown slugs and visitor-supplied system/tool messages, and only accepts a runtime advertising the evidence contract. The model gate rechecks pause on every round. Failed pause sync blocks calls. Boulder Creek must remain paused until its independent governance requirements are fulfilled; this implementation does not approve consultation or guardians.

## Start locally

Use the installed Hermes virtualenv Python for all three new scripts. Its current installation has Starlette, Uvicorn and httpx. Scripts add the gate/factguard source and Hermes checkout to Python's module path without modifying installed code.

Private environment variables:

- `KAMI_CODEX_BRIDGE_KEY`: separate loopback bridge credential.
- `KAMI_CODEX_MODEL`: default `gpt-5.6-luna`.
- `KAMI_HERMES_PROFILE_DIR`: absolute dedicated profile directory (config and SOUL).
- `KAMI_ENTITY_SLUG`: exact gate/profile slug.
- `PLATFORM_MCP_TOKEN`: existing entity MCP credential, externally injected.
- `KAMI_MODEL_GATE_KEY`: local model client credential; current gate is a loopback service.
- `API_SERVER_KEY`: harness-only credential.
- `HERMES_GATEWAY_API_KEY`: router credential used by the web relay.
- `GATE_ADMIN_SECRET`: existing gate admin secret used for the pause query.

Start `scripts/runtime/codex-bridge.py`, then entity-gate with upstream URL `http://127.0.0.1:8002` and `upstream_api_key_env: KAMI_CODEX_BRIDGE_KEY`, then `scripts/runtime/hermes-server.py`, then `scripts/runtime/router.py`. Gate provenance must say hosted/OpenAI/the actual model. Configure platform pause sync with fail_closed true and its real shared token. Only tunnel router port 8643; never tunnel the bridge, model gate or harness. No launchd service has been installed by these changes.

## Verification and remaining acceptance

78 gate/runtime regression tests passed, including the evidence-envelope improvement. Tests exercise streamed function arguments, continuation IDs, usage, incomplete streams, unauthorized/nonloopback calls, paused/offline gates, forged tool inputs, stock-gateway rejection and sanitized callback evidence.

*Verify*: a private QA profile using the actual installed Hermes auth and an unpaused **test** gate must complete a real get_place round through all layers. Verify actual usage, guarded fabricated-number rejection, geometry absence in model input, and final source footer. Test live Boulder Creek returns 423 without invoking a model. The harness disables auxiliary compression and requests Hermes interruption on disconnect, retaining the profile lock until that worker exits. Verify these paths against the live installed provider before allowing extended sessions. Confirm funded provider access and publish only the router through a stable HTTPS tunnel. Never treat the local MCP CLI success as proof of deployed website chat.

## Live private QA — September 7

A real run used the installed Hermes Python and existing OpenAI Codex OAuth, a temporary dedicated profile, and the real read-only twin/platform MCP connections. All services bound loopback only; an explicit local QA pause endpoint kept `boulder-creek` paused while allowing the isolated `qa-creek` test route. No production state or publication fields changed. Every temporary service was stopped after verification.

Results:

- A request for paused Boulder Creek returned HTTP 423 before any model invocation.
- The QA request passed router → Hermes → gate → OAuth bridge, called the live twin `get_place`, continued through the gate with its result, and returned a source footer followed by DONE.
- The reading at test time was 14.1 ft³/s, timestamp `2026-09-07T22:15:00Z`, source `cdss.telemetry`, stale false. This records test evidence, not a current reading for future readers.
- Two real completions reported prompt/output usage of 5,860/36 and 7,030/105 tokens. The guard dropped one unsupported sentence and emitted its disclosure; the measured reading passed.
- The footer carried the observed place/watershed IDs, timestamp, source ID and stale flag. No geometry appeared in the response. Handler-level regression proves nested geometry is removed before model input.
- The initial live run exposed a Hermes-specific `{result: "<JSON>"}` envelope that hid readings from factguard. The handler now unwraps that envelope before both model and evidence processing; the second live run verified the fix.
- All 79 gate/runtime tests passed, including this real-envelope regression.

This proves the local guarded model/tool loop. It does not assert an always-on deployment, a publicly reachable tunnel, completed guardians/consultation, live payment signing, or scheduled autonomous learning. Those require separate integration and acceptance.

## Durable Mac deployment

The guarded stack is installed as five launch agents, `earth.beings.bridge`, `.gate`, `.hermes`, `.router`, and `.tunnel`. They restart on failure and start when this macOS user logs in. These are login-session agents; machine sleep still makes the runtime unavailable.

- Runtime settings: `~/.kami/runtime/settings.json`, mode 0600. Plists contain no credential values.
- Dedicated runtime profile: `~/.kami/runtime/profile`; the interactive `beings-earth` profile is unchanged.
- Logs: `~/Library/Logs/beings-runtime`, private directory.
- Gate config: `~/.kami/runtime/gate.yaml`, explicit Boulder Creek pause plus fail-closed production pause synchronization.
- Stable router: `https://beings-gateway.omniharmonic.com`.
- Separate Cloudflare tunnel: `beings-earth-runtime`, ID `5ef38d17-377c-47e1-bf8b-e999752b29d9`. Existing tunnels and beings.earth DNS were not changed.

Only router port 8643 is exposed. Verified over HTTPS: anonymous POST returns 401; authorized Boulder Creek POST returns 423. All five launch agents were running. No public model request was permitted.

Vercel must use `HERMES_GATEWAY_URL` with the router URL, `HERMES_API_SERVER_KEY` with settings.json's `HERMES_GATEWAY_API_KEY` value, and `GATE_ADMIN_SECRET` with its matching generated value. The internal `API_SERVER_KEY` is for the local harness and must not be substituted for the router credential. Production pause synchronization was initially 401 pending deployment of that new shared secret, and the gate correctly failed closed.

Reinstallation is supported by `infra/mac/install-guarded-runtime.py`; it preserves generated local keys. The installer requires an existing production secret file, tunnel ID and hostname. `scripts/runtime/run-service.py` reads private JSON settings and launches the selected process without putting keys into launchd arguments.

## Scheduled stewardship and observed pause enforcement

The installed Hermes scheduler now owns five `no_agent` script jobs in the isolated runtime profile: hourly pulse, daily reflection at 06:30, Monday bounty drafting at 09:00, quarterly strategy evaluation at 09:00 on the first of January/April/July/October, and monthly donor narrative at 09:00 on the first. Timezone is America/Denver. `no_agent` here means Hermes's scheduler executes the reviewed script; that script explicitly constructs the guarded AIAgent only after its pause checks. It does not invoke an unguarded scheduler model.

`earth.beings.scheduler` runs the installed scheduler tick once per minute. Each task executes `scripts/runtime/steward-turn.py` in a separate process. The entry point checks production-synchronized pause state before MCP discovery and again before any model call. Background model requests carry `X-Kami-Job: cron` and use the gate's separate cron budget. No fallback model, shell tools, or signing tools are enabled.

Background platform mutations are limited to `post_update` and `draft_bounty`. Function-call arguments normally pass through the model proxy untouched, so the background MCP handler adds another factguard check immediately before executing a mutation, against only tool evidence collected in that same turn. It also rechecks pause immediately before the write. Unsupported mutations and unmeasured numeric claims are held. Website chat remains read-only; none of these permissions are exposed to its visitor interface.

Live verification on September 7 at 17:04 Denver time triggered the actual scheduled pulse once. Hermes recorded `last_status: ok`; its output was `status: skipped`, `reason: paused_or_sync_unavailable`, `model_calls: 0`. The next pulse remained scheduled for 18:00. The entity itself stayed paused and no publication or payment occurred. Five schedules are installed and enabled, but their ecological work is intentionally skipped while the being is paused.

`earth.beings.reporter` checks the real local gate, authenticated harness contract and successful production pause sync once per minute, then posts heartbeat and model provenance. Both production endpoints accepted the first report at `2026-09-07T23:02:21Z`. It sends no invented usage rows. The version-one telemetry protocol now delivers bounded usage counts and guard categories with stable event IDs, transactional deduplication and acknowledgment-based local cursors. It excludes raw model text, prompts and credentials. The local settings flag `KAMI_TELEMETRY_PROTOCOL: "1"` activates it after server deployment; legacy heartbeat clients remain compatible. Isolated QA usage is not imported as production activity.

Reproducible schedule installation: `infra/mac/install-steward-schedules.py --enable`. Omitting `--enable` installs disabled jobs. It uses installed Hermes `create_job`, `pause_job`, `resume_job` and `tick` APIs, not the unsupported flags in the old template commentary. The runtime installer now accepts `--slug` and `--source-profile`; this deployment serves one being per port set and refuses to overwrite another existing being.

Remaining route distinctions: the public router accepts visitor user/assistant messages only. The older donor-report helper that sends system/tool messages directly to that URL is deliberately refused; the scheduled trusted donor task instead uses MCP `post_update`. Summon voice-preview staging profiles are not provided by this single-profile runtime. No staging or visitor exception bypasses the role restrictions.

### Schedule times at installation

After the manual paused-skip verification, the recorded next runs were:

| Job | Next run (America/Denver) |
| --- | --- |
| Pulse | September 7, 2026, 18:00 |
| Daily reflection | September 8, 2026, 06:30 |
| Weekly bounties | September 14, 2026, 09:00 |
| Quarterly strategy | October 1, 2026, 09:00 |
| Donor report | October 1, 2026, 09:00 |

These are installation records; Hermes's private `cron/jobs.json` carries the subsequently advanced times.

To stop and disable every installed runtime service (without deleting credentials or changing entity governance):

```sh
for component in bridge gate hermes router tunnel scheduler reporter; do
  launchctl disable "gui/$(id -u)/earth.beings.$component"
  launchctl bootout "gui/$(id -u)/earth.beings.$component"
done
```

To pause only the schedules while retaining the website's guarded runtime, rerun `infra/mac/install-steward-schedules.py` without `--enable`, using the installed Hermes virtualenv Python. The entity's independent governance pause remains authoritative.

## Guardian resume synchronization fix — September 7

Two guardian resume requests legitimately cleared Boulder Creek's production pause at 2026-09-08T00:24:04.508Z. The local installer had also placed its slug in a static pause seed; the runtime unions that seed with synchronized platform state, so the seed incorrectly survived resume. The installed seed was removed after verifying the production resume. Future installations use no permanent seed and remain fail-closed until platform synchronization succeeds. The gate then reported an empty paused set and accepted a real measured-reading chat.

The habitat also displayed the pause explanation from an older health snapshot. Current governance pause is now passed separately to the avatar; historical health evidence remains unchanged and is labelled while an updated snapshot is pending. Actual pause/resume actions invalidate the entity layout and schedule a needs refresh after the response. A live refresh at 00:31:12.633Z confirmed the entity's resumed state. Signed-in navigation and My Account now expose the Guardian dashboard, including on narrow screens.
