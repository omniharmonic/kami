from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import pytest

from factguard.match import parse_instant, resolve_weekday, within_tolerance

DENVER = ZoneInfo("America/Denver")
AS_OF = datetime(2026, 9, 6, 5, 0, tzinfo=UTC)  # Saturday 23:00 MDT


@pytest.mark.parametrize("weekday,expected", [
    (4, date(2026, 9, 4)),   # Friday
    (5, date(2026, 9, 5)),   # Saturday = the as_of day itself (at or before)
    (6, date(2026, 8, 30)),  # Sunday: as_of is 05:00Z Sunday but Saturday in Denver
    (3, date(2026, 9, 3)),   # Thursday
])
def test_weekday_resolves_against_as_of_in_denver(weekday, expected):
    assert resolve_weekday(weekday, AS_OF, DENVER) == expected


def test_parse_instant_forms():
    assert parse_instant("2026-09-07") == date(2026, 9, 7)
    assert parse_instant("2026-09-04T20:15:00Z") == datetime(2026, 9, 4, 20, 15, tzinfo=UTC)
    assert parse_instant("2026-09-04T14:15:00-06:00") == datetime(2026, 9, 4, 20, 15,
                                                                  tzinfo=UTC)
    assert parse_instant("garbage") is None


@pytest.mark.parametrize("reply,fact,d,ok", [
    (15.4, 15.4, 1, True),
    (0.44, 0.43608, 2, True),     # within 0.005 and 0.9 %
    (12.0, 12.0, 0, True),
    (15.0, 15.4, 0, False),       # within 0.5 but rel. err 2.6 %
    (18.0, 15.4, 0, False),
    (0.0, 0.0, 1, True),
    (0.1, 0.0, 1, False),
    (1000.0, 1015.0, 0, False),   # rel ok but |diff| > 0.5
    (33.0, 32.78, 0, True),
])
def test_tolerance_rule(reply, fact, d, ok):
    assert within_tolerance(reply, fact, d) is ok
