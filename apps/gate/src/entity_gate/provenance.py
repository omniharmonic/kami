"""Provenance: where the model that answers actually runs, reported as a fact.

PRD §3 lists "no cloud frontier model on the hot path" as a non-goal and G7 promises a
public "how I work" page that names the model. Between those two sits a failure mode the
rest of this codebase exists to prevent: the page keeps saying "local" after the box is
pointed somewhere else, because copy is written once and inference moves.

So the gate does not assert a placement, it reports one. ``gate.yaml`` must name it
(``provenance.placement`` has no default), ``GET /healthz`` and ``GET /admin/provenance``
serve it, and this module pushes it to the platform on startup and every
``platform.heartbeat_seconds`` thereafter, with the same shared secret the heartbeat and
pause-set use. The public page renders what arrived, and renders "unknown" when nothing
did — a stale provenance report is treated like a stale reading, never like a fact that is
still true.
"""

from __future__ import annotations

import asyncio
import contextlib
import socket
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx

from .config import GateConfig


class ProvenanceReporter:
    def __init__(self, config: GateConfig,
                 client_factory: Callable[[], httpx.AsyncClient] | None = None,
                 on_event: Callable[[str, dict[str, Any]], None] | None = None,
                 host: str | None = None) -> None:
        self.config = config
        self.client_factory = client_factory or (lambda: httpx.AsyncClient(timeout=15))
        self.on_event = on_event
        self.host = host if host is not None else socket.gethostname()
        self.request_model: str | None = None   # last model a caller asked for
        self.last_publish_ok: bool | None = None
        self.last_publish_at: datetime | None = None
        self.last_error: str | None = None
        self._task: asyncio.Task | None = None

    # ---- the fact ------------------------------------------------------------------
    @property
    def url(self) -> str | None:
        return self.config.platform.provenance_url

    def note_request_model(self, model: str | None) -> None:
        if isinstance(model, str) and model:
            self.request_model = model

    def doc(self) -> dict[str, Any]:
        """What actually serves this gate. No secrets, no key values — names only."""
        cfg = self.config
        p = cfg.provenance
        return {
            "placement": p.placement,
            "provider": p.provider,
            "model": p.model or cfg.upstream_model or self.request_model,
            "upstream_url": cfg.upstream_url,
            "authenticated": bool(cfg.upstream_api_key_env),
            "api_key_env": cfg.upstream_api_key_env,   # the NAME of the variable, never its value
            "guard": "passthrough" if cfg.passthrough else "factguard",
            "slug": p.slug,
            "note": p.note,
            "gate_version": cfg.version,
        }

    def state(self) -> dict[str, Any]:
        return {
            "provenance": self.doc(),
            "reporting_to": self.url,
            "last_publish_ok": self.last_publish_ok,
            "last_publish_at": self.last_publish_at.isoformat() if self.last_publish_at else None,
            "last_error": self.last_error,
        }

    # ---- publishing ------------------------------------------------------------------
    def _headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        token = self.config.platform.resolved_token()
        if token:
            # `isGateSecret` in apps/web/src/lib/jobs/common.ts accepts either shape.
            headers["Authorization"] = f"Bearer {token}"
            headers["X-Gate-Admin"] = token
        return headers

    def body(self, now: datetime | None = None) -> dict[str, Any]:
        at = (now or datetime.now(UTC)).isoformat()
        doc = self.doc()
        return {"at": at, "host": self.host, "gate_version": self.config.version,
                "slug": doc.get("slug"), "provenance": doc}

    async def publish_once(self, now: datetime | None = None) -> bool:
        if not self.url:
            return True   # nothing configured: /healthz still tells the truth locally
        try:
            async with self.client_factory() as client:
                resp = await client.post(self.url, json=self.body(now), headers=self._headers())
                resp.raise_for_status()
            self.last_publish_ok = True
            self.last_error = None
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            self.last_publish_ok = False
            self.last_error = self.config.redact(repr(exc))
        self.last_publish_at = datetime.now(UTC)
        if self.on_event:
            self.on_event("provenance.publish",
                          {"ok": self.last_publish_ok, "url": self.url,
                           "placement": self.config.provenance.placement,
                           "error": self.last_error})
        return bool(self.last_publish_ok)

    async def start(self) -> None:
        if not self.url or self._task is not None:
            return
        await self.publish_once()
        self._task = asyncio.create_task(self._loop())

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(max(5.0, float(self.config.platform.heartbeat_seconds)))
            await self.publish_once()

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
