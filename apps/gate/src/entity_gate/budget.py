"""Per-slug daily token budgets keyed by the America/Denver date (§5.7).

Chat and cron draw from separate buckets (``X-Kami-Job: cron`` selects cron). Over budget →
429 with ``Retry-After`` = seconds until local midnight.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .config import Budget


@dataclass
class Usage:
    prompt: int = 0
    output: int = 0
    requests: int = 0


@dataclass
class BudgetDecision:
    ok: bool
    retry_after_s: int = 0
    reason: str | None = None
    used: Usage = field(default_factory=Usage)
    limits: tuple[int, int] = (0, 0)


class BudgetLedger:
    def __init__(self, budgets: dict[str, Budget], default: Budget, tz: str = "America/Denver",
                 clock: Callable[[], datetime] | None = None) -> None:
        self.budgets = budgets
        self.default = default
        self.zone = ZoneInfo(tz)
        self.clock = clock or (lambda: datetime.now(UTC))
        self._day: date | None = None
        self._usage: dict[tuple[str, str], Usage] = {}

    # ---- day handling -------------------------------------------------------------
    def _now_local(self) -> datetime:
        now = self.clock()
        if now.tzinfo is None:
            now = now.replace(tzinfo=UTC)
        return now.astimezone(self.zone)

    def _roll(self) -> None:
        today = self._now_local().date()
        if self._day != today:
            self._day = today
            self._usage = {}

    def seconds_until_midnight(self) -> int:
        now = self._now_local()
        tomorrow = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(),
                                    tzinfo=self.zone)
        return max(1, int((tomorrow - now).total_seconds()) + 1)

    # ---- api --------------------------------------------------------------------
    def budget_for(self, slug: str) -> Budget:
        return self.budgets.get(slug, self.default)

    def usage(self, slug: str, job: str) -> Usage:
        self._roll()
        return self._usage.setdefault((slug, job), Usage())

    def check(self, slug: str, job: str = "chat", est_prompt_tokens: int = 0) -> BudgetDecision:
        used = self.usage(slug, job)
        p_limit, o_limit = self.budget_for(slug).limits(job)
        if used.prompt >= p_limit or used.prompt + est_prompt_tokens > p_limit:
            return BudgetDecision(False, self.seconds_until_midnight(), "prompt_budget", used,
                                  (p_limit, o_limit))
        if used.output >= o_limit:
            return BudgetDecision(False, self.seconds_until_midnight(), "output_budget", used,
                                  (p_limit, o_limit))
        return BudgetDecision(True, 0, None, used, (p_limit, o_limit))

    def record(self, slug: str, job: str, prompt_tokens: int, output_tokens: int) -> Usage:
        used = self.usage(slug, job)
        used.prompt += max(0, int(prompt_tokens or 0))
        used.output += max(0, int(output_tokens or 0))
        used.requests += 1
        return used

    def snapshot(self) -> dict[str, Any]:
        self._roll()
        return {
            "day": self._day.isoformat() if self._day else None,
            "usage": {f"{slug}/{job}": {"prompt": u.prompt, "output": u.output,
                                        "requests": u.requests}
                      for (slug, job), u in self._usage.items()},
        }


def estimate_tokens(obj: Any) -> int:
    """Cheap request-size estimate (chars/4) used only for the pre-check."""
    import json
    try:
        return max(1, len(json.dumps(obj, ensure_ascii=False)) // 4)
    except (TypeError, ValueError):
        return 1
