"""Pydantic model of ``gate.yaml``."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field, field_validator


class Budget(BaseModel):
    prompt_tokens_per_day: int = 800_000
    output_tokens_per_day: int = 40_000
    cron_prompt_tokens_per_day: int = 400_000
    cron_output_tokens_per_day: int | None = None  # defaults to output_tokens_per_day

    def limits(self, job: str) -> tuple[int, int]:
        if job == "cron":
            out = self.cron_output_tokens_per_day
            return self.cron_prompt_tokens_per_day, (out if out is not None
                                                     else self.output_tokens_per_day)
        return self.prompt_tokens_per_day, self.output_tokens_per_day


class Concurrency(BaseModel):
    per_entity: int = 2
    queue: int = 8


class Platform(BaseModel):
    pause_set_url: str | None = None
    token: str | None = None
    token_env: str | None = "KAMI_PLATFORM_TOKEN"
    poll_seconds: float = 30
    # Architecture §12.5: the gate "pulls the pause set and budgets from the
    # platform and fails closed (refuses completions) if it cannot". A guardian
    # who pauses an entity must not be silently overruled by a network blip, so
    # the safe direction is the default: when a platform is configured and its
    # pause set cannot be read, every slug reads as paused. Set false only for a
    # deliberately offline box, and know what you are turning off.
    fail_closed: bool = True

    def resolved_token(self) -> str | None:
        if self.token:
            return self.token
        if self.token_env:
            return os.environ.get(self.token_env)
        return None


class GateConfig(BaseModel):
    upstream_url: str = "http://127.0.0.1:8000"
    listen: str = "127.0.0.1:8001"
    admin_secret_env: str = "GATE_ADMIN_SECRET"
    passthrough: bool = False
    tz: str = "America/Denver"
    default_budget: Budget = Field(default_factory=Budget)
    budgets: dict[str, Budget] = Field(default_factory=dict)
    concurrency: Concurrency = Field(default_factory=Concurrency)
    paused: list[str] = Field(default_factory=list)
    platform: Platform = Field(default_factory=Platform)
    gazetteer_path: str | None = None
    events_dir: str = "./events"
    upstream_timeout_s: float = 120
    crisis_enabled: bool = True
    admin_allow_hosts: list[str] = Field(default_factory=lambda: ["127.0.0.1", "::1"])

    @field_validator("upstream_url")
    @classmethod
    def _strip_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def listen_host(self) -> str:
        return self.listen.rsplit(":", 1)[0] if ":" in self.listen else self.listen

    @property
    def listen_port(self) -> int:
        return int(self.listen.rsplit(":", 1)[1]) if ":" in self.listen else 8001

    def budget_for(self, slug: str) -> Budget:
        return self.budgets.get(slug, self.default_budget)

    def admin_secret(self) -> str | None:
        return os.environ.get(self.admin_secret_env) or None


def load_config(path: str | Path | None, **overrides: Any) -> GateConfig:
    data: dict[str, Any] = {}
    if path is not None:
        with open(path, encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
    data.update({k: v for k, v in overrides.items() if v is not None})
    return GateConfig.model_validate(data)


def assert_safe_for_environment(config: "GateConfig", env: dict[str, str] | None = None) -> None:
    """Refuse to start a production gate that cannot enforce its own rules.

    ``passthrough`` skips the fact-sheet guard so the web app can be developed
    without a model; a kami running that way could utter any number it liked.
    ``fail_closed: false`` lets a pause be lost to a network error. Both are
    legitimate locally and neither is legitimate in production, so the gate
    refuses rather than running in a shape that quietly breaks rule 1.
    """
    import os as _os

    e = env if env is not None else _os.environ
    if e.get("KAMI_ENV", "").lower() not in {"production", "prod"}:
        return
    problems: list[str] = []
    if config.passthrough:
        problems.append("passthrough: true disables the fact-sheet guard")
    if config.platform.pause_set_url and not config.platform.fail_closed:
        problems.append("platform.fail_closed: false lets a guardian pause be lost to a network error")
    if problems:
        raise ValueError(
            "refusing to start in production with: " + "; ".join(problems)
            + ". Fix gate.yaml, or unset KAMI_ENV if this really is not production."
        )
