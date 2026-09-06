import pytest

from factguard.units import DEGREES_AMBIGUOUS, candidate_units, convert, normalize_unit


@pytest.mark.parametrize("value,src,dst,expected", [
    (15.4, "[ft_i]3/s", "m3/s", 0.43608),
    (1.0, "m3/s", "[ft_i]3/s", 35.3147),
    (53.6, "[degF]", "Cel", 12.0),
    (12.0, "Cel", "[degF]", 53.6),
    (1.0, "[in_i]", "mm", 25.4),
    (25.4, "mm", "cm", 2.54),
    (10.0, "ft", "m", 3.048),
    (118000, "s", "h", 32.7778),
    (2.0, "d", "h", 48.0),
    (7.0, "[acr_us].[ft_i]", "acre-feet", 7.0),
    (50.0, "%", "%", 50.0),
])
def test_conversions(value, src, dst, expected):
    assert convert(value, src, dst) == pytest.approx(expected, rel=1e-4)


def test_incompatible_or_unknown_returns_none():
    assert convert(1, "[ft_i]3/s", "Cel") is None
    assert convert(1, "furlong", "m") is None
    assert convert(1, "%", "mg/L") is None


@pytest.mark.parametrize("word,code", [
    ("cfs", "[ft_i]3/s"), ("cubic feet per second", "[ft_i]3/s"),
    ("cubic metres a second", "m3/s"), ("°C", "Cel"), ("degrees celsius", "Cel"),
    ("°F", "[degF]"), ("inches", "[in_i]"), ("acre-feet", "[acr_us].[ft_i]"),
    ("percent", "%"), ("%", "%"), ("mg/L", "mg/L"), ("hours", "h"), ("days", "d"),
    ("ug/m3", "ug/m3"), ("uS/cm", "uS/cm"), ("degrees", DEGREES_AMBIGUOUS),
])
def test_unit_words(word, code):
    assert normalize_unit(word) == code


def test_degrees_tries_both_scales():
    assert candidate_units("degrees") == ["Cel", "[degF]"]
