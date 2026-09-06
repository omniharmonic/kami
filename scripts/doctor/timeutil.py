"""One ISO-8601 parser, shared by every check that reports an age.

The twin and the platform both publish UTC timestamps ending in `Z`; a naive
timestamp is read as UTC rather than as local time, because guessing the
operator's zone would silently shift every age this tool prints.
"""

from __future__ import annotations

import datetime
import re
from typing import Optional

_OFFSET = re.compile(r"([+-]\d{2}):(\d{2})$")
_FORMATS = (
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%dT%H:%M:%S.%f%z",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M",
    "%Y-%m-%d",
)


def parse_iso(value: Optional[str]) -> Optional[float]:
    """Epoch seconds, or None when the value is absent or unparseable."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+0000"
    text = _OFFSET.sub(r"\1\2", text)
    for fmt in _FORMATS:
        try:
            parsed = datetime.datetime.strptime(text, fmt)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.timezone.utc)
        return parsed.timestamp()
    return None


def age_s(value: Optional[str], now: Optional[float] = None) -> Optional[float]:
    epoch = parse_iso(value)
    if epoch is None:
        return None
    import time as _time

    return (now if now is not None else _time.time()) - epoch
