"""pulse_precheck.py unit tests (T0.7): unchanged → false; changed reading → true; twin unreachable →
false and logged; the platform's answer wins over the fallback. Stdlib + monkeypatched urllib only."""

import copy
import io
import json
from email.message import Message
from urllib.error import HTTPError, URLError

import pytest

import pulse_precheck as pp

BINDING = {
    "schema_version": "1.0",
    "entity_id": "entity/boulder-creek",
    "members": [
        {"id": "place/boulder-creek-near-orodell-co", "role": "main_stem_gauge"},
        {"id": "place/niwot", "role": "snotel"},
    ],
    "watersheds": ["watershed/huc10-1019000504", "watershed/huc10-1019000505"],
}

CONDITIONS = {
    "generated_at": "2026-09-06T10:00:00Z",
    "stations": [
        {
            "id": "place/boulder-creek-near-orodell-co",
            "huc12": "101900050403",
            "readings": [
                {"property": "discharge", "value": 15.4, "unit": "[ft_i]3/s", "time": "2026-09-04T20:15:00Z",
                 "source_id": "cdss.telemetry", "stale": True, "staleness_s": 118000, "source_status": "ok"}
            ],
        },
        {  # member by id, huc12 outside the watersheds
            "id": "place/niwot",
            "huc12": "999999999999",
            "readings": [{"property": "swe", "value": 0.0, "unit": "[in_i]", "time": "2026-09-06T09:00:00Z",
                          "source_id": "awdb", "stale": False, "staleness_s": 3600, "source_status": "ok"}],
        },
        {  # not a member, inside a watershed by huc12 prefix
            "id": "place/some-ditch",
            "huc12": "101900050501",
            "readings": [{"property": "discharge", "value": 2.0, "unit": "[ft_i]3/s", "time": "2026-09-06T09:00:00Z",
                          "source_id": "cdss.telemetry", "stale": False, "staleness_s": 3600, "source_status": "ok"}],
        },
        {  # neither — must never influence the hash
            "id": "place/elsewhere",
            "huc12": "110200010101",
            "readings": [{"property": "discharge", "value": 7.0, "unit": "[ft_i]3/s", "time": "2026-09-06T09:00:00Z",
                          "source_id": "usgs.iv", "stale": False, "staleness_s": 3600, "source_status": "ok"}],
        },
    ],
}


class FakeResponse(io.BytesIO):
    def __init__(self, status, body, headers=None):
        super().__init__(body)
        self.status = status
        self.headers = Message()
        for k, v in (headers or {}).items():
            self.headers[k] = v

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()
        return False


def make_urlopen(routes):
    """routes: {url_prefix: callable(request) -> FakeResponse | raise}."""
    calls = []

    def fake_urlopen(req, timeout=None):
        url = req.full_url
        calls.append(req)
        for prefix, handler in routes.items():
            if url.startswith(prefix):
                return handler(req)
        raise URLError(f"no route for {url}")

    fake_urlopen.calls = calls
    return fake_urlopen


@pytest.fixture
def profile(tmp_path, monkeypatch):
    (tmp_path / "binding.json").write_text(json.dumps(BINDING))
    monkeypatch.setenv("KAMI_PROFILE_DIR", str(tmp_path))
    monkeypatch.setenv("KAMI_ENTITY_SLUG", "boulder-creek")
    monkeypatch.setenv("TWIN_BASE_URL", "https://twin.test")
    monkeypatch.delenv("PLATFORM_URL", raising=False)
    monkeypatch.delenv("PLATFORM_MCP_TOKEN", raising=False)
    return tmp_path


def run(monkeypatch, capsys, urlopen, argv=("pulse_precheck.py",)):
    monkeypatch.setattr(pp, "urlopen", urlopen)
    rc = pp.main(list(argv))
    out, err = capsys.readouterr()
    lines = [l for l in out.splitlines() if l.strip()]
    assert rc == 0
    assert len(lines) == 1, "exactly one JSON object on stdout"
    return json.loads(lines[0]), err


def twin_ok(body, etag='"abc"'):
    def handler(req):
        if req.get_header("If-none-match") == etag:
            raise HTTPError(req.full_url, 304, "Not Modified", Message(), None)
        return FakeResponse(200, json.dumps(body).encode(), {"ETag": etag})

    return handler


# --- fallback path -------------------------------------------------------------------------------


def test_first_run_wakes_and_records_hash(profile, monkeypatch, capsys):
    u = make_urlopen({"https://twin.test/latest/conditions.json": twin_ok(CONDITIONS)})
    res, _ = run(monkeypatch, capsys, u)
    assert res["wakeAgent"] is True
    assert res["source"] == "twin"
    assert res["reason"] == "first_run"
    assert res["stations"] == 3  # two members + one by huc12 prefix; `place/elsewhere` excluded
    assert (profile / "state" / "last_snapshot_hash").read_text().strip() == res["snapshot_hash"]
    assert (profile / "state" / "conditions.etag").read_text().strip() == '"abc"'
    ua = u.calls[0].get_header("User-agent")
    assert ua.startswith("kami-pulse/") and "(" in ua and ")" in ua


def test_unchanged_readings_do_not_wake(profile, monkeypatch, capsys):
    (profile / "state").mkdir()
    digest, _ = pp.slice_hash(CONDITIONS, *pp.load_binding(profile))
    (profile / "state" / "last_snapshot_hash").write_text(digest + "\n")
    # a new generated_at and new staleness_s values on every station — the body changes every cycle (B1 §1.1)
    body = copy.deepcopy(CONDITIONS)
    body["generated_at"] = "2026-09-06T11:00:00Z"
    for st in body["stations"]:
        for r in st["readings"]:
            r["staleness_s"] += 3600
    u = make_urlopen({"https://twin.test/latest/conditions.json": twin_ok(body, etag='"def"')})
    res, _ = run(monkeypatch, capsys, u)
    assert res["wakeAgent"] is False
    assert res["reason"] == "hash_unchanged"


def test_etag_match_short_circuits_to_no_wake(profile, monkeypatch, capsys):
    (profile / "state").mkdir()
    (profile / "state" / "conditions.etag").write_text('"abc"\n')
    u = make_urlopen({"https://twin.test/latest/conditions.json": twin_ok(CONDITIONS, etag='"abc"')})
    res, _ = run(monkeypatch, capsys, u)
    assert res == {"wakeAgent": False, "source": "twin", "reason": "etag_unchanged", "slug": "boulder-creek"}


def test_changed_reading_wakes(profile, monkeypatch, capsys):
    (profile / "state").mkdir()
    digest, _ = pp.slice_hash(CONDITIONS, *pp.load_binding(profile))
    (profile / "state" / "last_snapshot_hash").write_text(digest + "\n")
    body = copy.deepcopy(CONDITIONS)
    body["stations"][0]["readings"][0]["value"] = 16.1
    body["stations"][0]["readings"][0]["time"] = "2026-09-06T09:45:00Z"
    body["stations"][0]["readings"][0]["stale"] = False
    u = make_urlopen({"https://twin.test/latest/conditions.json": twin_ok(body, etag='"ghi"')})
    res, _ = run(monkeypatch, capsys, u)
    assert res["wakeAgent"] is True
    assert res["reason"] == "hash_changed"
    assert res["snapshot_hash"] != digest


def test_change_outside_the_slice_does_not_wake(profile, monkeypatch, capsys):
    (profile / "state").mkdir()
    digest, _ = pp.slice_hash(CONDITIONS, *pp.load_binding(profile))
    (profile / "state" / "last_snapshot_hash").write_text(digest + "\n")
    body = copy.deepcopy(CONDITIONS)
    body["stations"][3]["readings"][0]["value"] = 99.0  # place/elsewhere
    u = make_urlopen({"https://twin.test/latest/conditions.json": twin_ok(body, etag='"jkl"')})
    res, _ = run(monkeypatch, capsys, u)
    assert res["wakeAgent"] is False


def test_twin_unreachable_is_false_and_logged(profile, monkeypatch, capsys):
    def boom(req):
        raise URLError("connection refused")

    u = make_urlopen({"https://twin.test/": boom})
    res, err = run(monkeypatch, capsys, u)
    assert res["wakeAgent"] is False
    assert res["reason"] == "twin_unreachable"
    assert "twin unreachable" in err


def test_twin_timeout_is_false_and_logged(profile, monkeypatch, capsys):
    def slow(req):
        raise TimeoutError("timed out")

    u = make_urlopen({"https://twin.test/": slow})
    res, err = run(monkeypatch, capsys, u)
    assert res == {"wakeAgent": False, "source": "twin", "reason": "twin_unreachable", "slug": "boulder-creek"}
    assert "twin unreachable" in err


def test_twin_5xx_is_false_and_logged(profile, monkeypatch, capsys):
    def five_oh_three(req):
        raise HTTPError(req.full_url, 503, "Service Unavailable", Message(), None)

    u = make_urlopen({"https://twin.test/": five_oh_three})
    res, err = run(monkeypatch, capsys, u)
    assert res["wakeAgent"] is False
    assert res["reason"] == "twin_unreachable"
    assert "twin unreachable" in err


def test_never_raises_even_on_a_bug(profile, monkeypatch, capsys):
    def weird(req):
        raise RuntimeError("something nobody anticipated")

    u = make_urlopen({"https://twin.test/": weird})
    res, err = run(monkeypatch, capsys, u)
    assert res["wakeAgent"] is False
    assert res["reason"] == "precheck_error"
    assert "unexpected error" in err


def test_no_slug_is_false(monkeypatch, capsys):
    monkeypatch.delenv("KAMI_ENTITY_SLUG", raising=False)
    monkeypatch.delenv("PLATFORM_URL", raising=False)
    res, err = run(monkeypatch, capsys, make_urlopen({}))
    assert res == {"wakeAgent": False, "reason": "no_slug"}
    assert "no slug" in err


# --- platform path -------------------------------------------------------------------------------


def test_platform_answer_wins_over_fallback(profile, monkeypatch, capsys):
    monkeypatch.setenv("PLATFORM_URL", "https://platform.test/")
    monkeypatch.setenv("PLATFORM_MCP_TOKEN", "tok-1")
    seen = {}

    def platform(req):
        seen["auth"] = req.get_header("Authorization")
        return FakeResponse(200, json.dumps({"changed": False, "snapshot_id": "snap_9"}).encode())

    # the twin would say "changed" (first run) — the platform's "unchanged" must win
    u = make_urlopen({
        "https://platform.test/api/entities/boulder-creek/precheck": platform,
        "https://twin.test/latest/conditions.json": twin_ok(CONDITIONS),
    })
    res, _ = run(monkeypatch, capsys, u)
    assert res == {"wakeAgent": False, "source": "platform", "snapshot_id": "snap_9", "slug": "boulder-creek"}
    assert seen["auth"] == "Bearer tok-1"
    assert all("twin.test" not in r.full_url for r in u.calls), "no twin fetch when the platform answered"


def test_platform_changed_true_wakes(profile, monkeypatch, capsys):
    monkeypatch.setenv("PLATFORM_URL", "https://platform.test")
    u = make_urlopen({
        "https://platform.test/api/entities/boulder-creek/precheck":
            lambda req: FakeResponse(200, json.dumps({"changed": True, "snapshot_id": "snap_10"}).encode()),
    })
    res, _ = run(monkeypatch, capsys, u)
    assert res["wakeAgent"] is True and res["source"] == "platform" and res["snapshot_id"] == "snap_10"


def test_platform_unreachable_falls_back_to_twin(profile, monkeypatch, capsys):
    monkeypatch.setenv("PLATFORM_URL", "https://platform.test")

    def down(req):
        raise URLError("refused")

    u = make_urlopen({
        "https://platform.test/": down,
        "https://twin.test/latest/conditions.json": twin_ok(CONDITIONS),
    })
    res, err = run(monkeypatch, capsys, u)
    assert res["source"] == "twin" and res["wakeAgent"] is True
    assert "platform unreachable" in err


def test_platform_and_twin_both_down(profile, monkeypatch, capsys):
    monkeypatch.setenv("PLATFORM_URL", "https://platform.test")

    def down(req):
        raise URLError("refused")

    res, err = run(monkeypatch, capsys, make_urlopen({"https://": down}))
    assert res["wakeAgent"] is False and res["reason"] == "twin_unreachable"
    assert "platform unreachable" in err and "twin unreachable" in err


def test_slug_from_argv_overrides_env(profile, monkeypatch, capsys):
    monkeypatch.setenv("PLATFORM_URL", "https://platform.test")
    u = make_urlopen({
        "https://platform.test/api/entities/other-creek/precheck":
            lambda req: FakeResponse(200, json.dumps({"changed": False}).encode()),
    })
    res, _ = run(monkeypatch, capsys, u, argv=("pulse_precheck.py", "other-creek"))
    assert res["slug"] == "other-creek" and res["wakeAgent"] is False


# --- pure helpers --------------------------------------------------------------------------------


def test_strip_excluded_is_recursive_and_order_independent():
    a = {"b": 1, "generated_at": "x", "nested": [{"staleness_s": 5, "v": 2}]}
    b = {"nested": [{"v": 2, "staleness_s": 9}], "generated_at": "y", "b": 1}
    assert pp.strip_excluded(a) == pp.strip_excluded(b) == {"b": 1, "nested": [{"v": 2}]}


def test_station_list_accepts_dict_shape():
    cond = {"stations": {"place/a": {"huc12": "1", "readings": []}}}
    assert pp.station_list(cond) == [{"id": "place/a", "huc12": "1", "readings": []}]


def test_load_binding_missing_file_matches_nothing(tmp_path):
    members, prefixes = pp.load_binding(tmp_path)
    assert members == set() and prefixes == []
    assert pp.slice_hash(CONDITIONS, members, prefixes)[1] == 0
