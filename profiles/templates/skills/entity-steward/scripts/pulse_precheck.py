#!/usr/bin/env python3
"""pulse_precheck.py — the no-LLM pre-script of the hourly `pulse` cron job (architecture §5.3, A.2).

Prints exactly one JSON object on stdout, always with a boolean `wakeAgent`, and exits 0. Never raises.

    {"wakeAgent": false, "source": "platform", ...}

Order of business:
  1. Ask the platform:  GET {PLATFORM_URL}/api/entities/{slug}/precheck   (bearer PLATFORM_MCP_TOKEN, 5 s)
     → {"changed": bool, "snapshot_id": ...}. The platform's answer always wins.
  2. If the platform is unreachable, fall back to the twin: GET {TWIN_BASE_URL}/latest/conditions.json with
     If-None-Match and a User-Agent that carries a contact; keep only stations whose `huc12` falls inside the
     binding's watersheds OR whose id is a binding member; hash their readings with `generated_at` and
     `staleness_s` removed (latest/ bodies change every cycle, B1 §1.1); compare with
     ~/.hermes/profiles/<slug>/state/last_snapshot_hash.
  3. If the twin is unreachable too: {"wakeAgent": false, "reason": "twin_unreachable"} and a log line.

Environment (all optional except the slug):
  KAMI_ENTITY_SLUG      the entity slug (or pass it as argv[1])
  PLATFORM_URL          e.g. https://<platform>          (absent → skip straight to the twin fallback)
  PLATFORM_MCP_TOKEN    bearer for the platform call
  TWIN_BASE_URL         default https://data.bioregionaltwin.org
  KAMI_PROFILE_DIR      default ~/.hermes/profiles/<slug>  (holds binding.json and state/)
  KAMI_PULSE_CONTACT    contact put in the User-Agent (default hello@kami.invalid — set it)

Stdlib only, Python 3.11. Polls the twin at most once per run; the job runs hourly, well under the 60 s floor.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

VERSION = "0.1.0"
TIMEOUT_S = 5.0
DEFAULT_TWIN = "https://data.bioregionaltwin.org"
EXCLUDED_KEYS = frozenset({"generated_at", "staleness_s"})
WATERSHED_RE = re.compile(r"^watershed/huc(?P<level>\d+)-(?P<code>\d+)$")


def log(msg: str) -> None:
    sys.stderr.write(f"pulse_precheck: {msg}\n")


def emit(obj: dict[str, Any]) -> None:
    obj.setdefault("wakeAgent", False)
    obj["wakeAgent"] = bool(obj["wakeAgent"])
    sys.stdout.write(json.dumps(obj, sort_keys=True) + "\n")
    sys.stdout.flush()


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def user_agent() -> str:
    contact = os.environ.get("KAMI_PULSE_CONTACT", "hello@kami.invalid")
    return f"kami-pulse/{VERSION} ({contact})"


def http_get(url: str, headers: dict[str, str]) -> tuple[int, dict[str, str], bytes]:
    """GET → (status, lowercased headers, body). 304 is returned, not raised. Network errors propagate."""
    req = Request(url, headers={"User-Agent": user_agent(), "Accept": "application/json", **headers})
    try:
        with urlopen(req, timeout=TIMEOUT_S) as resp:  # noqa: S310 — https URLs from our own config
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
    except HTTPError as e:
        if e.code == 304:
            return 304, {k.lower(): v for k, v in (e.headers or {}).items()}, b""
        raise


# ---------------------------------------------------------------------------
# Step 1 — the platform
# ---------------------------------------------------------------------------


def ask_platform(slug: str) -> dict[str, Any] | None:
    base = os.environ.get("PLATFORM_URL", "").rstrip("/")
    if not base:
        return None
    token = os.environ.get("PLATFORM_MCP_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        status, _, body = http_get(f"{base}/api/entities/{slug}/precheck", headers)
    except (URLError, HTTPError, TimeoutError, OSError, ValueError) as e:
        log(f"platform unreachable ({e.__class__.__name__}: {e}); falling back to the twin")
        return None
    if status != 200:
        log(f"platform answered {status}; falling back to the twin")
        return None
    try:
        data = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        log(f"platform body unparseable ({e}); falling back to the twin")
        return None
    if not isinstance(data, dict) or "changed" not in data:
        log("platform body lacks `changed`; falling back to the twin")
        return None
    out: dict[str, Any] = {"wakeAgent": bool(data["changed"]), "source": "platform"}
    if "snapshot_id" in data:
        out["snapshot_id"] = data["snapshot_id"]
    return out


# ---------------------------------------------------------------------------
# Step 2 — the twin fallback
# ---------------------------------------------------------------------------


def load_binding(profile_dir: Path) -> tuple[set[str], list[str]]:
    """→ (member ids, watershed code prefixes). Missing binding → empty sets (then nothing matches)."""
    path = profile_dir / "binding.json"
    try:
        binding = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log(f"binding.json unreadable at {path} ({e}); no stations will match")
        return set(), []
    members: set[str] = set()
    for m in binding.get("members") or []:
        if isinstance(m, dict) and isinstance(m.get("id"), str):
            members.add(m["id"])
        elif isinstance(m, str):
            members.add(m)
    prefixes: list[str] = []
    for w in binding.get("watersheds") or []:
        if isinstance(w, str):
            mt = WATERSHED_RE.match(w)
            if mt:
                prefixes.append(mt.group("code"))
    return members, prefixes


def station_list(conditions: Any) -> list[dict[str, Any]]:
    """Accept `{stations: [...]}`, `{stations: {id: {...}}}`, or a bare list."""
    if isinstance(conditions, dict):
        stations = conditions.get("stations", conditions.get("places", []))
    else:
        stations = conditions
    if isinstance(stations, dict):
        out = []
        for sid, st in stations.items():
            if isinstance(st, dict):
                out.append({"id": st.get("id", sid), **st})
        return out
    if isinstance(stations, list):
        return [s for s in stations if isinstance(s, dict)]
    return []


def in_slice(station: dict[str, Any], members: set[str], prefixes: list[str]) -> bool:
    sid = station.get("id")
    if isinstance(sid, str) and sid in members:
        return True
    huc12 = station.get("huc12")
    if isinstance(huc12, str) and huc12:
        return any(huc12.startswith(p) for p in prefixes)
    return False


def strip_excluded(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: strip_excluded(v) for k, v in sorted(value.items()) if k not in EXCLUDED_KEYS}
    if isinstance(value, list):
        return [strip_excluded(v) for v in value]
    return value


def slice_hash(conditions: Any, members: set[str], prefixes: list[str]) -> tuple[str, int]:
    picked = []
    for st in station_list(conditions):
        if in_slice(st, members, prefixes):
            picked.append({"id": st.get("id"), "readings": strip_excluded(st.get("readings", []))})
    picked.sort(key=lambda s: str(s.get("id")))
    canonical = json.dumps(picked, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest(), len(picked)


def read_state(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def write_state(path: Path, value: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value + "\n", encoding="utf-8")
    except OSError as e:
        log(f"could not write {path} ({e})")


def ask_twin(slug: str, profile_dir: Path) -> dict[str, Any]:
    base = os.environ.get("TWIN_BASE_URL", DEFAULT_TWIN).rstrip("/")
    state_dir = profile_dir / "state"
    etag_path = state_dir / "conditions.etag"
    hash_path = state_dir / "last_snapshot_hash"
    headers: dict[str, str] = {}
    etag = read_state(etag_path)
    if etag:
        headers["If-None-Match"] = etag
    try:
        status, resp_headers, body = http_get(f"{base}/latest/conditions.json", headers)
    except (URLError, HTTPError, TimeoutError, OSError, ValueError) as e:
        log(f"twin unreachable ({e.__class__.__name__}: {e})")
        return {"wakeAgent": False, "source": "twin", "reason": "twin_unreachable"}
    if status == 304:
        return {"wakeAgent": False, "source": "twin", "reason": "etag_unchanged"}
    if status != 200:
        log(f"twin answered {status}")
        return {"wakeAgent": False, "source": "twin", "reason": "twin_unreachable", "status": status}
    try:
        conditions = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as e:
        log(f"conditions.json unparseable ({e})")
        return {"wakeAgent": False, "source": "twin", "reason": "twin_unparseable"}

    members, prefixes = load_binding(profile_dir)
    digest, n = slice_hash(conditions, members, prefixes)
    previous = read_state(hash_path)
    changed = previous != digest
    if "etag" in resp_headers:
        write_state(etag_path, resp_headers["etag"])
    write_state(hash_path, digest)
    out: dict[str, Any] = {
        "wakeAgent": changed,
        "source": "twin",
        "reason": "hash_changed" if changed else "hash_unchanged",
        "stations": n,
        "snapshot_hash": digest,
    }
    if previous is None:
        out["reason"] = "first_run"
    return out


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def resolve_slug(argv: list[str]) -> str | None:
    if len(argv) > 1 and argv[1] and not argv[1].startswith("-"):
        return argv[1]
    return os.environ.get("KAMI_ENTITY_SLUG") or None


def profile_dir_for(slug: str) -> Path:
    env = os.environ.get("KAMI_PROFILE_DIR")
    return Path(env) if env else Path.home() / ".hermes" / "profiles" / slug


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    try:
        slug = resolve_slug(argv)
        if not slug:
            log("no slug (argv[1] or KAMI_ENTITY_SLUG)")
            emit({"wakeAgent": False, "reason": "no_slug"})
            return 0
        answer = ask_platform(slug)
        if answer is None:
            answer = ask_twin(slug, profile_dir_for(slug))
        answer["slug"] = slug
        emit(answer)
    except Exception as e:  # noqa: BLE001 — the contract is: never raise, never wake by accident
        log(f"unexpected error ({e.__class__.__name__}: {e})")
        emit({"wakeAgent": False, "reason": "precheck_error", "error": f"{e.__class__.__name__}: {e}"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
