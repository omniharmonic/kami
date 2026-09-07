# beings.earth production handoff

Updated 2026-09-07. This supersedes the hostname and email setup notes in `first-deploy.md`.

## Live deployment

- Site: https://beings.earth
- Project: `kami-web`, `prj_fSbKysNQvRIsM9lYA0JL6k6BJiLx`, team `omniharmonics-projects`.
- Deployment: `dpl_6G5PCs87UgtGttceroJn91mZwFb9` (production, READY).
- Deployment URL: https://kami-2b2tlpr7u-omniharmonics-projects.vercel.app
- Aliases: beings.earth, www.beings.earth, kami-web-one.vercel.app.
- Deployed from the local working tree with Vercel CLI. Source changes are preserved on the local `codex/beings-earth-production` branch. A later Git deployment must include this branch to retain the fixes; it has not been pushed.

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
