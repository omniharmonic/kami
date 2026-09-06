# kami-treasury-mcp

The stdio MCP server Hermes launches beside each entity profile. **Exactly three tools**, no key, no signing library:

| tool | platform call |
|---|---|
| `get_balance(entity?)` | `GET $PLATFORM_URL/api/treasury/<slug>/balance` |
| `list_pending(entity?)` | `GET $PLATFORM_URL/api/treasury/<slug>/pending` |
| `propose_bounty_payout(submission_id)` | `GET $PLATFORM_URL/api/entities/<slug>/state` (refuses if `paused`) then `POST $PLATFORM_URL/api/treasury/propose` `{"entity": slug, "submission_id": ...}` |

Every request carries `Authorization: Bearer $PLATFORM_MCP_TOKEN` with a 10 s timeout. The platform's signing service holds the proposer key and validates the proposal (ADR-E05, architecture §7.3); this process can only ask.

```
PLATFORM_URL=https://kami.example PLATFORM_MCP_TOKEN=… python -m treasury_mcp --entity boulder-creek
treasury-mcp --entity boulder-creek        # console script; KAMI_ENTITY_SLUG works instead of --entity
```

The token is never logged (only method + path are), and the test suite asserts that `eth_account`, `web3`, `eth_keys` and `safe_eth` are neither declared dependencies nor imported.
