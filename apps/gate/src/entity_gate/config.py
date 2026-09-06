"""Pydantic model of ``gate.yaml``."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator


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
    base_url: str | None = None
    pause_set_url: str | None = None
    # Where the gate reports what is actually serving it (see Provenance). Defaults to
    # ``{base_url}/api/gate/provenance`` so a box only has to name the platform once.
    provenance_url: str | None = None
    token: str | None = None
    token_env: str | None = "KAMI_PLATFORM_TOKEN"
    poll_seconds: float = 30
    # How often the gate re-reports provenance. The platform treats a stale report the way
    # it treats a stale reading: as unknown, not as "still true".
    heartbeat_seconds: float = 300
    # Architecture §12.5: the gate "pulls the pause set and budgets from the
    # platform and fails closed (refuses completions) if it cannot". A guardian
    # who pauses an entity must not be silently overruled by a network blip, so
    # the safe direction is the default: when a platform is configured and its
    # pause set cannot be read, every slug reads as paused. Set false only for a
    # deliberately offline box, and know what you are turning off.
    fail_closed: bool = True

    @field_validator("base_url")
    @classmethod
    def _strip_base_slash(cls, v: str | None) -> str | None:
        return v.rstrip("/") if isinstance(v, str) else v

    @model_validator(mode="after")
    def _derive_urls(self) -> Platform:
        if self.provenance_url is None and self.base_url:
            self.provenance_url = self.base_url + "/api/gate/provenance"
        return self

    def resolved_token(self) -> str | None:
        if self.token:
            return self.token
        if self.token_env:
            return os.environ.get(self.token_env)
        return None


Placement = Literal["owned", "rented", "hosted"]


class Provenance(BaseModel):
    """Where the model that answers actually runs.

    ``placement`` has **no default**. A gate that cannot say where its model runs
    cannot be described honestly on the public "how I work" page, and the page is
    generated from this, not from prose someone remembered to update. So the gate
    refuses to start without it, exactly as it refuses a production passthrough.

    * ``owned``  — hardware the project owns (the DGX Spark, an RTX 4090 in a closet).
    * ``rented`` — a GPU box rented by the hour or the month; the project controls the
      process, someone else owns the metal.
    * ``hosted`` — someone else's API. The prompt and the reply leave the project's
      machines. PRD §3 lists this as a non-goal; see docs/planning/ERRATA.md row 7.
    """

    placement: Placement
    provider: str | None = None   # "OpenRouter", "LM Studio on a Mac mini", "vLLM on a DGX Spark"
    model: str | None = None      # what actually serves; falls back to upstream_model, then the request's
    slug: str | None = None       # which entity this gate serves, when it serves exactly one
    note: str | None = None       # one honest sentence the public page may quote


# Keys that must never appear in gate.yaml: a secret in a config file ends up in git, in
# backups, in `cat gate.yaml` over someone's shoulder, and in the support ticket where they
# paste their config.
_FORBIDDEN_CONFIG_KEYS = ("upstream_api_key", "api_key", "upstream_token", "openai_api_key")
_FORBIDDEN_HEADERS = ("authorization", "x-api-key", "api-key", "x-goog-api-key")
_SECRET_ADVICE = (
    "Put the key in an environment variable and name the variable instead, e.g.\n"
    "  upstream_api_key_env: OPENROUTER_API_KEY"
)


class GateConfig(BaseModel):
    # ---- upstream ---------------------------------------------------------------
    upstream_url: str = "http://127.0.0.1:8000"
    upstream_api_key_env: str | None = None      # NAME of the env var, never the key
    upstream_headers: dict[str, str] = Field(default_factory=dict)  # e.g. HTTP-Referer
    upstream_model: str | None = None            # what the upstream calls the profile's model
    # Loopback vLLM answers in milliseconds; a hosted API queues, cold-starts and rate-limits.
    # 300 s is deliberately generous — a timeout here reads to a visitor as the kami being
    # asleep, which is worse than waiting.
    request_timeout_s: float = 300
    upstream_timeout_s: float | None = None      # legacy alias for request_timeout_s

    # ---- provenance (required) ---------------------------------------------------
    provenance: Provenance

    # ---- everything else ---------------------------------------------------------
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
    crisis_enabled: bool = True
    admin_allow_hosts: list[str] = Field(default_factory=lambda: ["127.0.0.1", "::1"])
    version: str | None = None                   # reported with the heartbeat

    @model_validator(mode="before")
    @classmethod
    def _reject_literal_secrets_and_require_provenance(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        for key in _FORBIDDEN_CONFIG_KEYS:
            if key in data:
                raise ValueError(f"{key!r} must not appear in gate.yaml. {_SECRET_ADVICE}")
        headers = data.get("upstream_headers")
        if isinstance(headers, dict):
            for name in headers:
                if isinstance(name, str) and name.strip().lower() in _FORBIDDEN_HEADERS:
                    raise ValueError(
                        f"upstream_headers must not carry {name!r} — that is a secret in a "
                        f"config file. {_SECRET_ADVICE}")
        if data.get("provenance") is None:
            raise ValueError(
                "gate.yaml needs a provenance block naming where the model runs:\n"
                "  provenance:\n"
                "    placement: owned | rented | hosted\n"
                "    provider: \"vLLM on a DGX Spark\"\n"
                "A gate that cannot say where its model runs must not start — the public "
                "\"how I work\" page is rendered from this, not from copy someone remembers "
                "to update.")
        return data

    @field_validator("upstream_url")
    @classmethod
    def _strip_slash(cls, v: str) -> str:
        return v.rstrip("/")

    # ---- upstream helpers ---------------------------------------------------------
    @property
    def timeout_s(self) -> float:
        """``request_timeout_s``, or the legacy ``upstream_timeout_s`` when a box still sets it."""
        return self.request_timeout_s if self.upstream_timeout_s is None else self.upstream_timeout_s

    def upstream_api_key(self, env: dict[str, str] | None = None) -> str | None:
        if not self.upstream_api_key_env:
            return None
        source = env if env is not None else os.environ
        return source.get(self.upstream_api_key_env) or None

    def upstream_request_headers(self, env: dict[str, str] | None = None) -> dict[str, str]:
        """Static headers plus ``Authorization: Bearer …`` when a key env var is configured."""
        headers = {k: v for k, v in self.upstream_headers.items()}
        key = self.upstream_api_key(env)
        if key:
            headers["Authorization"] = f"Bearer {key}"
        return headers

    def apply_upstream_model(self, body: dict[str, Any]) -> dict[str, Any]:
        """Rewrite ``model`` for the upstream and change nothing else."""
        if not self.upstream_model:
            return body
        return {**body, "model": self.upstream_model}

    def redact(self, text: str, env: dict[str, str] | None = None) -> str:
        """Never let the upstream key reach a log line, an event row or an error body."""
        key = self.upstream_api_key(env)
        return text.replace(key, "[redacted]") if key else text

    # ---- listen / budgets / admin ---------------------------------------------------
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


def assert_safe_for_environment(config: GateConfig, env: dict[str, str] | None = None) -> None:
    """Refuse to start a production gate that cannot enforce its own rules.

    ``passthrough`` skips the fact-sheet guard so the web app can be developed
    without a model; a kami running that way could utter any number it liked.
    ``fail_closed: false`` lets a pause be lost to a network error. Both are
    legitimate locally and neither is legitimate in production, so the gate
    refuses rather than running in a shape that quietly breaks rule 1.

    A ``hosted`` placement is **not** on this list. Running on someone else's API
    deviates from PRD §3 and the deviation is recorded in ERRATA row 7; the
    mitigation is that the gate reports it, not that the gate forbids it. What
    would be dishonest is running hosted while the page says local, and that is
    impossible now: the page renders what the gate reports.
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
    if config.upstream_api_key_env and not config.upstream_api_key():
        problems.append(f"upstream_api_key_env names {config.upstream_api_key_env}, which is unset")
    if problems:
        raise ValueError(
            "refusing to start in production with: " + "; ".join(problems)
            + ". Fix gate.yaml, or unset KAMI_ENV if this really is not production."
        )
