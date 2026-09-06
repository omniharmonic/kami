"""All user-facing strings the gate itself authors (one copy module per app)."""

from factguard import FALLBACK, GATE_LINE, STALE_TEMPLATE

CRISIS_TEMPLATE = (
    "I'm an AI voice for a place, and this is something a person should be with you for. "
    "If you are thinking about harming yourself, please reach out right now: "
    "call or text 988 to reach the 988 Suicide & Crisis Lifeline (US, 24/7), "
    "or text HOME to 741741 for the Crisis Text Line. "
    "If you are in immediate danger, call 911. "
    "You matter, and people are ready to listen."
)

PAUSED_MESSAGE = "This entity is paused by its guardians."
BUDGET_MESSAGE = "I've talked a lot today; back tomorrow."
QUEUE_FULL_MESSAGE = "Too many people are talking to me right now."

GUARD_REGENERATE_SYSTEM = (
    "GUARD: your previous answer cited things that are not in this turn's tool results and "
    "cannot be published. Violations:\n{violations}\n"
    "Answer again using only numbers, times, places and species that appear in the tool "
    "results of this turn. If you have no reading for something, say \"I don't have a reading "
    "for that.\" Do not estimate, compare to normal, or name anything you did not look up."
)

__all__ = [
    "BUDGET_MESSAGE",
    "CRISIS_TEMPLATE",
    "FALLBACK",
    "GATE_LINE",
    "GUARD_REGENERATE_SYSTEM",
    "PAUSED_MESSAGE",
    "QUEUE_FULL_MESSAGE",
    "STALE_TEMPLATE",
]
