"""Fixed unit conversion table (ADR-E04) plus unit-word recognition in prose.

Canonical codes are UCUM as used by the twin: ``[ft_i]3/s``, ``m3/s``, ``Cel``, ``[degF]``,
``[in_i]``, ``mm``, ``cm``, ``[acr_us].[ft_i]``, ``m``, ``ft``, ``%``, ``ug/m3``, ``mg/L``,
``uS/cm``, ``ppb``, ``s``, ``min``, ``h``, ``d``.
"""

from __future__ import annotations

import re

CFS_TO_M3S = 0.0283168

# canonical -> (dimension, factor, offset); base = value * factor + offset
_TABLE: dict[str, tuple[str, float, float]] = {
    "[ft_i]3/s": ("flow", 1.0, 0.0),
    "m3/s": ("flow", 1.0 / CFS_TO_M3S, 0.0),
    "Cel": ("temperature", 1.0, 0.0),
    "[degF]": ("temperature", 5.0 / 9.0, -32.0 * 5.0 / 9.0),
    "[in_i]": ("depth", 1.0, 0.0),
    "mm": ("depth", 1.0 / 25.4, 0.0),
    "cm": ("depth", 1.0 / 2.54, 0.0),
    "[acr_us].[ft_i]": ("volume", 1.0, 0.0),
    "m": ("length", 1.0, 0.0),
    "ft": ("length", 0.3048, 0.0),
    "%": ("ratio", 1.0, 0.0),
    "ug/m3": ("air_concentration", 1.0, 0.0),
    "ppb": ("mixing_ratio", 1.0, 0.0),
    "mg/L": ("water_concentration", 1.0, 0.0),
    "uS/cm": ("conductivity", 1.0, 0.0),
    "s": ("time", 1.0, 0.0),
    "min": ("time", 60.0, 0.0),
    "h": ("time", 3600.0, 0.0),
    "d": ("time", 86400.0, 0.0),
}

#: The ambiguous prose unit "degrees" (no scale given): the matcher tries both scales.
DEGREES_AMBIGUOUS = "deg?"

# lowercase alias -> canonical. Used both for atom units (UCUM variants) and prose words.
_ALIASES: dict[str, str] = {
    # flow
    "[ft_i]3/s": "[ft_i]3/s", "ft3/s": "[ft_i]3/s", "ft³/s": "[ft_i]3/s", "cfs": "[ft_i]3/s",
    "cubic feet per second": "[ft_i]3/s", "cubic foot per second": "[ft_i]3/s",
    "cubic feet a second": "[ft_i]3/s",
    "m3/s": "m3/s", "m³/s": "m3/s", "cms": "m3/s", "cumecs": "m3/s", "cumec": "m3/s",
    "cubic metres per second": "m3/s", "cubic meters per second": "m3/s",
    "cubic metres a second": "m3/s", "cubic meters a second": "m3/s",
    "cubic metre per second": "m3/s", "cubic meter per second": "m3/s",
    "cubic metre a second": "m3/s", "cubic meter a second": "m3/s",
    # temperature
    "cel": "Cel", "c": "Cel", "°c": "Cel", "℃": "Cel", "degc": "Cel", "deg c": "Cel",
    "degrees c": "Cel", "degrees celsius": "Cel", "celsius": "Cel",
    "[degf]": "[degF]", "degf": "[degF]", "f": "[degF]", "°f": "[degF]", "℉": "[degF]",
    "deg f": "[degF]", "degrees f": "[degF]", "degrees fahrenheit": "[degF]",
    "fahrenheit": "[degF]",
    "degrees": DEGREES_AMBIGUOUS, "°": DEGREES_AMBIGUOUS,
    # depth / precipitation
    "[in_i]": "[in_i]", "in": "[in_i]", "inch": "[in_i]", "inches": "[in_i]", '"': "[in_i]",
    "″": "[in_i]",
    "mm": "mm", "millimetre": "mm", "millimetres": "mm", "millimeter": "mm", "millimeters": "mm",
    "cm": "cm", "centimetre": "cm", "centimetres": "cm", "centimeter": "cm", "centimeters": "cm",
    # volume
    "[acr_us].[ft_i]": "[acr_us].[ft_i]", "acre-feet": "[acr_us].[ft_i]",
    "acre feet": "[acr_us].[ft_i]", "acre-foot": "[acr_us].[ft_i]", "acre foot": "[acr_us].[ft_i]",
    "acre-ft": "[acr_us].[ft_i]", "ac-ft": "[acr_us].[ft_i]", "acft": "[acr_us].[ft_i]",
    "af": "[acr_us].[ft_i]",
    # length
    "m": "m", "metre": "m", "metres": "m", "meter": "m", "meters": "m",
    "ft": "ft", "feet": "ft", "foot": "ft",
    # ratio
    "%": "%", "percent": "%", "per cent": "%", "pct": "%",
    # concentrations
    "ug/m3": "ug/m3", "µg/m3": "ug/m3", "µg/m³": "ug/m3", "ug/m³": "ug/m3", "μg/m3": "ug/m3",
    "micrograms per cubic metre": "ug/m3", "micrograms per cubic meter": "ug/m3",
    "ppb": "ppb", "parts per billion": "ppb",
    "mg/l": "mg/L", "milligrams per litre": "mg/L", "milligrams per liter": "mg/L",
    "us/cm": "uS/cm", "µs/cm": "uS/cm", "μs/cm": "uS/cm",
    "microsiemens per centimetre": "uS/cm", "microsiemens per centimeter": "uS/cm",
    # time
    "s": "s", "sec": "s", "secs": "s", "second": "s", "seconds": "s",
    "min": "min", "mins": "min", "minute": "min", "minutes": "min",
    "h": "h", "hr": "h", "hrs": "h", "hour": "h", "hours": "h",
    "d": "d", "day": "d", "days": "d",
}

# Prose words the extractor recognises after a number. Bare single letters and "in"/"af"
# are deliberately absent (too ambiguous in prose); symbols are handled separately.
_PROSE_WORDS = [
    "cubic feet per second", "cubic foot per second", "cubic feet a second",
    "cubic metres per second", "cubic meters per second", "cubic metres a second",
    "cubic meters a second", "cubic metre per second", "cubic meter per second",
    "cubic metre a second", "cubic meter a second", "cfs", "cms", "cumecs", "cumec",
    "degrees celsius", "degrees fahrenheit", "degrees c", "degrees f", "deg c", "deg f",
    "celsius", "fahrenheit", "degrees",
    "inches", "inch", "millimetres", "millimeters", "millimetre", "millimeter", "mm",
    "centimetres", "centimeters", "centimetre", "centimeter", "cm",
    "acre-feet", "acre feet", "acre-foot", "acre foot", "acre-ft", "ac-ft", "acft",
    "metres", "meters", "metre", "meter", "feet", "foot", "ft",
    "percent", "per cent", "pct",
    "micrograms per cubic metre", "micrograms per cubic meter", "parts per billion", "ppb",
    "milligrams per litre", "milligrams per liter", "mg/l",
    "microsiemens per centimetre", "microsiemens per centimeter",
    "seconds", "second", "secs", "sec", "minutes", "minute", "mins", "hours", "hour", "hrs", "hr",
    "days", "day",
]
_PROSE_SYMBOLS = ["µg/m³", "µg/m3", "μg/m3", "ug/m³", "ug/m3", "µs/cm", "μs/cm", "us/cm",
                  "m³/s", "m3/s", "ft³/s", "ft3/s", "°c", "°f", "℃", "℉", "°", "%", "″", '"']

_words_alt = "|".join(re.escape(w) for w in sorted(_PROSE_WORDS, key=len, reverse=True))
_symbols_alt = "|".join(re.escape(s) for s in sorted(_PROSE_SYMBOLS, key=len, reverse=True))
#: Matches an optional unit immediately after a number (group ``unit``).
UNIT_AFTER_NUMBER_RE = re.compile(
    rf"(?:\s*(?P<sym>{_symbols_alt})|\s+(?P<word>{_words_alt})(?![\w/]))",
    re.IGNORECASE,
)


def normalize_unit(text: str | None) -> str | None:
    """Return the canonical code for a UCUM string or a prose unit word, else None."""
    if text is None:
        return None
    t = text.strip()
    if t in _TABLE:
        return t
    return _ALIASES.get(t.lower())


def dimension(unit: str | None) -> str | None:
    u = normalize_unit(unit)
    if u is None or u == DEGREES_AMBIGUOUS:
        return "temperature" if u == DEGREES_AMBIGUOUS else None
    return _TABLE[u][0]


def convert(value: float, from_unit: str | None, to_unit: str | None) -> float | None:
    """Convert ``value`` between two units of the same dimension; None if not possible."""
    src = normalize_unit(from_unit)
    dst = normalize_unit(to_unit)
    if src is None or dst is None or src == DEGREES_AMBIGUOUS or dst == DEGREES_AMBIGUOUS:
        return None
    sdim, sf, so = _TABLE[src]
    ddim, df, do = _TABLE[dst]
    if sdim != ddim:
        return None
    base = value * sf + so
    return (base - do) / df


def is_time_unit(unit: str | None) -> bool:
    return dimension(unit) == "time"


def to_seconds(value: float, unit: str | None) -> float | None:
    return convert(value, unit, "s")


def candidate_units(unit: str | None) -> list[str]:
    """Units the matcher should try for a prose unit ('degrees' -> both scales)."""
    u = normalize_unit(unit)
    if u is None:
        return []
    if u == DEGREES_AMBIGUOUS:
        return ["Cel", "[degF]"]
    return [u]
