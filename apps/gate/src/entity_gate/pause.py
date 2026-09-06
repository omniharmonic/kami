"""PauseSet: yaml seed + admin push + optional poll of the platform pause-set URL (ADR-E12).

Three layers are unioned: the ``gate.yaml`` seed, admin pushes, and the platform's set
(refreshed every ``poll_seconds``). ``fail_closed`` makes ``is_paused`` answer True for every
slug while the platform set has not been fetched successfully.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx

from .config import Platform


class PauseSet:
    def __init__(self, seed: list[str] | None = None, platform: Platform | None = None,
                 client_factory: Callable[[], httpx.AsyncClient] | None = None,
                 on_change: Callable[[str, dict[str, Any]], None] | None = None) -> None:
        self.seed: set[str] = set(seed or [])
        self.admin: set[str] = set()
        self.platform_set: set[str] = set()
        self.platform = platform
        self.client_factory = client_factory or (lambda: httpx.AsyncClient(timeout=10))
        self.on_change = on_change
        self.last_sync_ok: bool | None = None
        self.last_sync_at: datetime | None = None
        self.last_error: str | None = None
        self._task: asyncio.Task | None = None

    # ---- queries ------------------------------------------------------------------
    @property
    def configured(self) -> bool:
        return bool(self.platform and self.platform.pause_set_url)

    @property
    def fail_closed_active(self) -> bool:
        return bool(self.configured and self.platform.fail_closed and self.last_sync_ok is not True)

    @property
    def paused(self) -> set[str]:
        return self.seed | self.admin | self.platform_set

    def is_paused(self, slug: str) -> bool:
        if self.fail_closed_active:
            return True
        return slug in self.paused

    def state(self) -> dict[str, Any]:
        return {
            "paused": sorted(self.paused),
            "seed": sorted(self.seed),
            "admin": sorted(self.admin),
            "platform": sorted(self.platform_set),
            "platform_configured": self.configured,
            "fail_closed_active": self.fail_closed_active,
            "last_sync_ok": self.last_sync_ok,
            "last_sync_at": self.last_sync_at.isoformat() if self.last_sync_at else None,
            "last_error": self.last_error,
        }

    # ---- mutations ----------------------------------------------------------------
    def pause(self, slug: str, by: str | None = None) -> None:
        self.admin.add(slug)
        if self.on_change:
            self.on_change("pause", {"slug": slug, "by": by})

    def resume(self, slug: str, guardians: list[str]) -> None:
        """Two distinct guardian names are required (validated by the caller too)."""
        names = [g.strip() for g in guardians if isinstance(g, str) and g.strip()]
        if len({n.lower() for n in names}) < 2:
            raise ValueError("resume requires two distinct guardian names")
        self.admin.discard(slug)
        self.seed.discard(slug)
        if self.on_change:
            self.on_change("resume", {"slug": slug, "guardians": names})

    # ---- platform poll ------------------------------------------------------------
    async def refresh_once(self) -> bool:
        if not self.configured:
            return True
        assert self.platform is not None
        headers = {}
        token = self.platform.resolved_token()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        try:
            async with self.client_factory() as client:
                resp = await client.get(self.platform.pause_set_url, headers=headers)
                resp.raise_for_status()
                doc = resp.json()
            slugs = doc.get("paused", []) if isinstance(doc, dict) else doc
            if not isinstance(slugs, list):
                raise TypeError("pause set must be a list or {'paused': [...]}")
            self.platform_set = {s if isinstance(s, str) else s.get("slug") for s in slugs}
            self.platform_set.discard(None)
            self.last_sync_ok = True
            self.last_error = None
        except (httpx.HTTPError, ValueError, TypeError, KeyError, AttributeError) as exc:
            self.last_sync_ok = False
            self.last_error = repr(exc)
        self.last_sync_at = datetime.now(UTC)
        return bool(self.last_sync_ok)

    async def start(self) -> None:
        if not self.configured or self._task is not None:
            return
        await self.refresh_once()
        self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        assert self.platform is not None
        while True:
            await asyncio.sleep(max(1.0, float(self.platform.poll_seconds)))
            await self.refresh_once()

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
