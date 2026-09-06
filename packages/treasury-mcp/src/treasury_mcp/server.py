"""The MCP server. Three tools, registered explicitly; nothing else is exposed."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from mcp.server.mcpserver import MCPServer
from pydantic import BaseModel, Field

from .client import PlatformClient, Settings

log = logging.getLogger("treasury_mcp")

TOOL_NAMES: tuple[str, ...] = ("get_balance", "list_pending", "propose_bounty_payout")


class ProposeResult(BaseModel):
    ok: bool
    entity: str
    submission_id: str
    safe_tx_hash: str | None = None
    status: str | None = None
    message: str = Field(default="")


def build_server(settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> MCPServer:
    client = PlatformClient(settings, transport=transport)
    server = MCPServer(
        name="kami-treasury",
        instructions=(
            "Treasury of the entity's Safe. You can read the balance, list pending proposals, "
            "and propose a payout for an evaluated submission. You cannot sign or execute anything; "
            "two human guardians sign every payout."
        ),
    )

    @server.tool(name="get_balance", description="USDC balance and recent inflows/outflows of the entity's Safe, as reported by the platform.")
    async def get_balance(entity: str | None = None) -> dict[str, Any]:
        return await client.balance(entity)

    @server.tool(name="list_pending", description="Safe proposals awaiting guardian signatures (amount, recipient, confirmations, age).")
    async def list_pending(entity: str | None = None) -> dict[str, Any]:
        return await client.pending(entity)

    @server.tool(
        name="propose_bounty_payout",
        description=(
            "Ask the platform to propose a USDC payout for a submission whose evaluation succeeded. "
            "The platform's signing service validates it and creates a pending Safe transaction; "
            "guardians sign. Refused while the entity is paused."
        ),
    )
    async def propose_bounty_payout(submission_id: str) -> ProposeResult:
        slug = client.resolve_entity(None)
        state = await client.entity_state(slug)
        if state.get("paused") or state.get("state") == "paused":
            reason = state.get("reason") or state.get("pause_reason") or ""
            return ProposeResult(
                ok=False, entity=slug, submission_id=submission_id, status="refused",
                message=f"{slug} is paused by a guardian; no payouts can be proposed until it is resumed. {reason}".strip(),
            )
        r = await client.propose(slug, submission_id)
        return ProposeResult(
            ok=True, entity=slug, submission_id=submission_id,
            safe_tx_hash=r.get("safe_tx_hash"), status=r.get("status"),
            message="proposed; waiting for two guardian signatures",
        )

    server._kami_client = client  # type: ignore[attr-defined]  # for tests / shutdown
    return server
