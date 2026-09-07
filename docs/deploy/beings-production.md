# beings.earth production handoff

Updated 2026-09-07. This supersedes the hostname and email setup notes in `first-deploy.md`.

## Live deployment

- Site: https://beings.earth
- Project: `kami-web`, `prj_fSbKysNQvRIsM9lYA0JL6k6BJiLx`, team `omniharmonics-projects`.
- Deployment: `dpl_6G5PCs87UgtGttceroJn91mZwFb9` (production, READY).
- Deployment URL: https://kami-2b2tlpr7u-omniharmonics-projects.vercel.app
- Aliases: beings.earth, www.beings.earth, kami-web-one.vercel.app.
- Deployed from the local working tree with Vercel CLI. The production work was pushed to `main` at `857af8a`. Local main is synchronized with origin.

Namecheap DNS now has two `@` A records (`216.150.1.1`, `216.150.16.1`) and a `www` CNAME to `be008f89f6fff621.vercel-dns-016.com`. Default parking records were removed. Vercel verified both names; the apex returned HTTP 200 over valid HTTPS. DNS remains on Namecheap BasicDNS.

## Email and sign-in

The sender is `beings.earth <beings@omniharmonic.com>`. Resend's existing verified omniharmonic.com domain is reused; no additional email domain was added. The production API key is sending-only and restricted to that domain, stored as a Vercel Secret. The recipient/account email is `synergy@benjaminlife.one`; beings@omniharmonic.com is only the sender (delivery to it bounced).

`BETTER_AUTH_URL=https://beings.earth`. A new deployment applies this setting. A session on the former vercel.app hostname does not authenticate another hostname or another browser.

1. Open https://beings.earth/sign-in in the browser where you want to work.
2. Enter your account email, confirm you are 13 or older, and choose **Send me a link**.
3. Open the newest **Your beings.earth sign-in link** email in that same browser. The link is single-use and expires in ten minutes.
4. **My account** should appear in the header; https://beings.earth/me should display your email. Visiting sign-in while authenticated redirects there.
5. Choose **Summon a being** to resume a saved draft. The Left Hand Creek draft is `smn_10f544934b8310a3db`; its place proposal was saved successfully. The selected-place panel now provides **Continue to appearance** above the detailed review.

Verified before changing the canonical hostname: Resend delivered the email to synergy@benjaminlife.one, the account was email-verified, sessions were created, and Arc's `/me` displayed the correct account. The misleading hardcoded Sign in header was fixed and covered by regression tests. Final-domain sign-in was then verified with a newly delivered magic link in the production browser: the header displayed synergy@benjaminlife.one and the steward connection page loaded.

The production mailer refuses an absent Resend key; it does not print production magic links to logs. Local development retains its explicit logging fallback.

## Agent connection walkthrough

Open `/e/<slug>/connect` as that being's creator, steward, or platform admin. A guardian may inspect the connection but cannot mint a token. Boulder Creek is seeded, private, and paused; the user explicitly authorized steward access and that role was granted to synergy@benjaminlife.one on September 7. No platform-admin role was granted. Left Hand Creek is a saved draft and still needs its remaining creation steps and real guardian details.

On the connection page:

1. Review the entity identity, scope, pause state, and tool catalog.
2. Create the entity credential using the page's explicit mint action. Save it as `PLATFORM_MCP_TOKEN` in the agent's private environment. It is displayed once; do not paste it into a repository, chat, or public document.
3. Download the connection bundle. It contains the exact soul, binding, skill, and client configuration, with a token placeholder rather than the credential.
4. For Claude Code, load the HTTP platform server from the bundle into `.mcp.json`, then start Claude with `PLATFORM_MCP_TOKEN` in its environment. Use `/mcp` to inspect connection status. Environment expansion is supported in headers.
5. For Hermes, merge the HTTP server into `mcp_servers` in the intended profile's `config.yaml`, with `Authorization: "Bearer ${PLATFORM_MCP_TOKEN}"`. Put the token in that profile's private `.env`. Run `hermes mcp test <server-name>` in that profile before using its tools.
6. Test discovery and a read-only `get_entity_config` call before agent writes or recurring jobs. Preserve the entity's pause state and publication requirements.

The platform endpoint is https://beings.earth/mcp (Streamable HTTP). Anonymous access was verified to return HTTP 401 with `invalid or missing entity token`. Both Hermes and Claude Code authenticated successfully and discovered all nine platform tools. A direct SDK get_entity_config call returned Boulder Creek, the correct steward, and paused=true. The first live mint test exposed a missing slug in the form; both mint and rotate forms now submit it, with regression tests.

Connecting an MCP client is distinct from powering website chat. Public chat additionally needs the guarded Hermes runtime, its reachable gateway URL and matching server key, and live guard/pause verification. The default Hermes profile found on this Mac had its gateway stopped. Do not advertise an active website agent or a completed twin integration from the MCP connection alone.

Client references: [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Hermes MCP configuration](https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference).

## Verification

- Current web regression suite: 87 files, 780 tests passed. Earlier browser verification: 58 passed, one expected database-fixture skip.
- Runtime profile-script compatibility suite: 41 tests passed.
- New account membership/privacy regression passed separately, plus web typecheck.
- Final production `/me` verified: Boulder Creek Private/Paused with Connect agent; Left Hand Creek resumes at appearance, step 2.
- Account navigation + authentication regression suite: 7 tests passed.
- TypeScript checks passed after final selected-place changes.
- Final Vercel production build: READY.
- Vercel domain verification: apex and www valid.
- Latest deployment error-log scan: no errors returned in the sampled ten-minute window.
- Remaining: guarded always-on model runtime, completed binding/guardian/consultation steps, and a model-driven Claude Code test after renewed Claude authentication.


## Published twin and local clients (verified September 7)

The published endpoint is https://mcp.bioregionaltwin.org/mcp, Streamable HTTP, public and read-only, with 20 tools. It is not an npm package. Bundles and Hermes templates now use the HTTP endpoint, with a separate local-checkout example for custom trees. The hosted service does not load a being's private binding; use the platform snapshot and published IDs from the bundle. See https://bioregionaltwin.org/agent-api.md.

- Hermes profile: `beings-earth`, separate from the existing default profile.
- Both servers connected: `bioregional-twin` (20 tools) and `kami-platform` (9 tools).
- Launcher: `~/.local/bin/beings-agent`. Run `beings-agent hermes` or `beings-agent claude` from this project.
- The launcher loads the entity credential from `~/.kami/credentials/boulder-creek.env`, mode 0600, outside the repository and profile. Client configs contain only environment placeholders.
- Read-only verification: `beings-agent hermes mcp test kami-platform`, `hermes --profile beings-earth mcp test bioregional-twin`, and Claude Code `mcp get` for both servers passed.
- An actual MCP SDK `find_species` call returned the published Elk profile identifier with its observation-count caveats. This is a reporting catalog, not an abundance estimate.
- Claude Code's model-driven test could not start: its OAuth session expired and could not refresh. Run `claude auth login` before `beings-agent claude`. No model tokens were consumed by that failed test.

## Runtime compatibility findings

Installed Hermes exposes `/v1/chat/completions` for one active profile, while the web relay expects `/p/<slug>/v1/chat/completions`. It does not forward the gate's structured evidence event. The old cron flags and claimed write-approval fields were unsupported. The Mac launcher now uses the supported foreground command and loopback API settings; automated deployment fails before remote mutation when required runtime semantics remain unavailable. A dry run reports those blockers.

Website chat is still not configured. A working launch needs an authenticated per-profile route adapter, a funded model through the fact guard, working pause integration, evidence forwarding, and a reachable gateway. The connection page now correctly reports an empty gateway as not set up, even if an old heartbeat exists. A successful MCP handshake does not establish that those runtime components are running.


## OpenAI-backed local agent (September 7 follow-up)

The user's existing Hermes OpenAI Codex sign-in is active. The dedicated beings-earth profile now uses their preferred `gpt-5.6-luna` model through that existing sign-in; no API credential was copied into the repository.

A live model-driven, read-only `list_datasets` diagnostic passed and returned `conditions` and `alerts`. The installed CLI backgrounds MCP discovery and waits only briefly before its initial tool snapshot; the first one-shot test had no ecological tools. `scripts/run-beings-hermes.py` now discovers both MCP servers synchronously before chat and refuses to start when either required discovery tool is missing. The private `beings-agent` launcher uses that adapter for chat while preserving normal Hermes management commands.

Start a local session from this checkout:

```sh
beings-agent hermes --skills entity-steward
```

The saved credential is injected by the private launcher. `beings-agent hermes mcp test kami-platform` checks the platform independently. This local model diagnostic does not verify the public website chat, guarded hosting adapter, or recurring work. Those remain unconfigured; Boulder Creek remains private and paused.


## Sensor-discovery correction

A pending binding was previously excluded from the needs context and then serialized as zero members, no anchor, and no watersheds in get_entity_config. This incorrectly told the model that the being had no sensing body. The configuration now exposes schema-validated proposed member IDs, names and roles, with explicit binding_review and binding_active fields. Missing or invalid membership reports a null count instead of zero. The approved-only needs calculation is unchanged. The updated entity-steward skill directs read-only diagnostics to query the anchor and gauge members with public twin get_place calls even while the binding awaits review.

Verification: 14 MCP tests passed, including pending/invalid binding regression and unchanged review state; web typecheck passed.

## Approved watershed and private agent verification (September 7)

The steward explicitly approved the broader connected watershed candidate v2: 12 configured places and five driving need mappings. The installation used a database transaction, verified the accepted steward role, required the existing private/paused v1 state, inserted the reviewed v2 row, moved the current pointer, and appended a hash-chained `binding.approved` event. The chain verified with four events. No guardian, consultation, pause or publication field changed.

The first real needs run stored snapshot 1 at `2026-09-07T18:09:47.140Z`, hash `b540e378767d5d84c0c8f1cc52a378e4b046159a93f82a957cbbdcd8a8cd95f6`. Publication was withheld (`consultation_not_done`). Snow was stale; the snapshot was asleep and also reported the paused state. A real Hermes/OpenAI turn retrieved approved v2, the 12-place membership, all five needs with provenance and freshness, and the public Orodell observation. It kept the single anchor distinct from the broader watershed. The dedicated local profile now carries v2. The production connection page independently showed v2 approved and recent authenticated activity.

The repository's original `profiles/boulder-creek/binding.yaml` remains a v1 regression fixture; it is not production truth. Current clients should refresh the authenticated bundle and start with `get_entity_config`. That tool now exposes `membership_rule` and `need_mappings`, so agents can distinguish driving assessments from contextual members without inferring from stale local files. The entity-steward instructions also separate connection, binding review, snapshot availability, freshness, pause and public runtime.

A related scientific correction removes the `mean_24h` fallback to an instantaneous reading when no usable series exists. The mean stays unknown; raw observations remain available. Tests cover absent series, samples outside the window, and an actual mean distinct from the latest reading.

### Next runtime work — not yet running

The installed `hermes proxy` supports Nous and xAI, not the user's OpenAI Codex OAuth provider. Keeping that sign-in behind the existing gate requires a loopback Chat Completions/Responses transport adapter that preserves tool-call IDs, streaming, usage and credential refresh. The installed auxiliary Codex client is not suitable: it drops tool continuation linkage and buffers output. Reuse the main Codex transport instead.

Website chat additionally requires authenticated per-slug routing, full sanitized tool evidence forwarding from Hermes's completion callback, a configuration check proving every model round goes through the gate, production pause synchronization, and a reachable HTTPS gateway. Begin the guarded runtime test with the entity still paused and require HTTP 423. Do not enable learning jobs or treat the private CLI diagnostic as proof of a guarded public runtime.

### Remaining onboarding work

- Give stewards a reviewable binding approval and first-snapshot workflow in the UI, removing the one-time operator script used here.
- Show binding/snapshot readiness separately from connection activity on the connect page.
- Detect stale downloaded profiles and offer a safe refresh that preserves credentials and model preferences.
- Package the synchronous Hermes MCP startup check in the downloadable client setup, including installed-version checks.
- Replace unsupported recurring-job assumptions with verified installed Hermes capabilities; test the first loop before scheduling it.

### Repeatable private setup check

On this device run `beings-agent doctor`. The private launcher supplies the existing entity credential and `KAMI_HERMES_PROFILE=beings-earth`; it invokes `bash scripts/kami-doctor --only agent`. Other installations can set `PLATFORM_URL`, `PLATFORM_MCP_TOKEN`, and `KAMI_ENTITY_SLUG` in their private environment and run the same repository command. The diagnostic uses MCP initialization and four read-only tool calls. It follows no credential-bearing redirects and prints no raw tool data or geometry.

Live result on September 7: eight checks passed, zero failed, one data-freshness warning, and one explicitly skipped public-runtime check. Fifteen mocked diagnostic regressions and the existing secret-redaction self-test passed. The setup check consumes no model credits and changes no entity state.

### Private dashboard preview

The signed-in walkthrough found that the private page still read only published status, so it displayed no meters even though Hermes could read snapshot 1. The page and layout now authorize the viewer before loading a private DB snapshot. The public status cache, metadata and OG path are unchanged. The preview requires the currently pointed binding to be approved and the snapshot to be at least as new as that approval; absent provenance stays unavailable. No public file is written. This lets stewards review actual needs before completing consultation.
