# Guarded Hermes runtime implementation

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
