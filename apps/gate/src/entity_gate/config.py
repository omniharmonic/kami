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
    fail_closed: bool = False

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
