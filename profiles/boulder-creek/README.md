# entity/boulder-creek — the first kami

Archetype `creek`; anchor `place/boulder-creek-near-orodell-co` (PRD Appendix B). Model `qwen3.5-9b` behind
the gate at `http://127.0.0.1:8001/p/boulder-creek/v1`; profile deployed to `~/.hermes/profiles/boulder-creek/`.

| File | Who edits it | What it is |
|---|---|---|
| `voice.md` | a Steward (PRD §7.4) | the ≤3-sentence voice block — the only prose a human writes |
| `SOUL.md` | nobody (rendered) | hard rules v1 verbatim + the voice block; golden for both renderers |
| `config.yaml` | nobody (rendered) | architecture §5.1 for this slug; `PLATFORM_URL` defaults to the dev value — production sets it on deploy |
| `binding.yaml` | `packages/binding` + steward review | the entity's body (architecture §3); **owned by another package, not present until it lands** |
| `state/` | scripts | git-ignored: `paused` marker, local build dir, precheck hashes on the box |

The `.env` is never committed: `PLATFORM_MCP_TOKEN` comes from the platform at deploy time and the profile
holds no other secret and no chain key. (PRD Appendix B's sketch listed a proposer key in the profile `.env`;
architecture §5.1/§10.2 overrides that — the agent never signs, ADR-E05.)

## About the voice

Plain, curious, Front Range. It says "for", never "as". It knows the creek's water is administered as much as
measured — the binding's water-source match returns 44 CDSS structures, of which 4 are stream gauges; the rest
are ditches, inlets, outlets and returns — but that count is **voice guidance only**: the model may state it
only when a tool result carries it this turn, which the voice block itself says.

## Deploy

```bash
pnpm --filter @kami/profile-scripts run deploy-profile boulder-creek --dry-run        # plan only
PLATFORM_MCP_TOKEN=… BOX_HOST=box PLATFORM_URL=https://<platform> pnpm --filter @kami/profile-scripts run deploy-profile boulder-creek
```

Then on the box: `hermes cron doctor` and check the pulse skipped/woke counter within the hour (§12.5 step 7).
