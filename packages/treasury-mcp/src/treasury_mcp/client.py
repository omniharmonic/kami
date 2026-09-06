"""HTTP client for the platform's treasury routes. Bearer token, 10 s timeout, no key."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger("treasury_mcp")

TIMEOUT_S = 10.0


class MissingTokenError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    platform_url: str
    token: str
    entity: str | None

    @classmethod
    def from_env(cls, entity: str | None = None, env: dict[str, str] | None = None) -> "Settings":
        e = os.environ if env is None else env
        url = e.get("PLATFORM_URL", "").rstrip("/")
        if not url:
            raise MissingTokenError("PLATFORM_URL is not set")
        token = e.get("PLATFORM_MCP_TOKEN", "")
        if not token:
            raise MissingTokenError(
                "PLATFORM_MCP_TOKEN is not set — the treasury MCP needs the entity's scoped "
                "platform token (from the Hermes profile .env; it is not a chain key)"
            )
        return cls(platform_url=url, token=token, entity=entity or e.get("KAMI_ENTITY_SLUG") or None)


class PlatformClient:
    """Thin wrapper over httpx. Logs method + path only; never the headers."""

    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.platform_url,
            timeout=httpx.Timeout(TIMEOUT_S),
            headers={"Authorization": f"Bearer {settings.token}", "User-Agent": "kami-treasury-mcp/0.1"},
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    def resolve_entity(self, entity: str | None) -> str:
        slug = entity or self._settings.entity
        if not slug:
            raise ValueError("no entity: pass entity=… or start the server with --entity / KAMI_ENTITY_SLUG")
        return slug

    async def _request(self, method: str, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
        log.debug("%s %s", method, path)
        r = await self._client.request(method, path, json=json)
        if r.status_code >= 400:
            detail = ""
            try:
                detail = r.json().get("error", "")
            except Exception:  # noqa: BLE001 — body may not be JSON
                detail = r.text[:200]
            raise RuntimeError(f"platform {method} {path} → HTTP {r.status_code} {detail}".rstrip())
        return r.json()

    async def balance(self, entity: str | None = None) -> dict[str, Any]:
        slug = self.resolve_entity(entity)
        return await self._request("GET", f"/api/treasury/{slug}/balance")

    async def pending(self, entity: str | None = None) -> dict[str, Any]:
        slug = self.resolve_entity(entity)
        return await self._request("GET", f"/api/treasury/{slug}/pending")

    async def entity_state(self, slug: str) -> dict[str, Any]:
        return await self._request("GET", f"/api/entities/{slug}/state")

    async def propose(self, slug: str, submission_id: str) -> dict[str, Any]:
        return await self._request("POST", "/api/treasury/propose", json={"entity": slug, "submission_id": submission_id})
