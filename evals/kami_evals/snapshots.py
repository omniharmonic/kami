"""Twin snapshots (``fixtures/snapshots/*.json``) in the shape ``get_entity_status`` returns
(`packages/twin-mcp/src/entity.ts` → ``EntityStatus``), plus the helpers every runner shares:
loading, validation, turning a snapshot into the ``role: tool`` message of an OpenAI request,
and building the turn's fact sheet exactly the way the gate does.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from factguard import FactSheet, Gazetteer

from .paths import GAZETTEER_PATH, HARD_RULES_PATH, SNAPSHOTS_DIR

#: Every reading crossing a boundary carries these (CLAUDE.md invariants; twin survey §2.1).
HONESTY_FIELDS = ("time", "unit", "source_id", "stale", "staleness_s", "source_status")
SOURCE_STATUS = {"ok", "warning", "critical", "unknown"}
ATOM_KINDS = {"number", "time", "place", "species", "count", "enum"}
ATOM_REQUIRED = {
    "number": ("value",), "time": ("value",), "place": ("id", "name"),
    "species": ("name",), "count": ("value", "of"), "enum": ("name", "value"),
}
#: Tools the model may call (profile config: twin + treasury + platform include lists).
ALLOWED_TOOLS = (
    "get_entity_status", "get_alerts", "get_reading_history", "get_place", "explain",
    "get_health", "compare_to_normal",
    "get_balance", "list_pending", "propose_bounty_payout",
    "get_needs_snapshot", "get_entity_config", "list_open_bounties", "draft_bounty",
    "list_submissions", "read_evidence_summary", "post_update", "get_strategy",
    "get_attestation_summary",
)
ENTITY = "entity/boulder-creek"
PLACE_NAME = "Boulder Creek"
PLACE_KIND = "creek"
#: The platform-injected config block the gate admits as atoms (caps, guardian names) — the
#: same convention the gate's tests use (docs/verify.md #31).
ENTITY_CONFIG = {"slug": "boulder-creek", "caps": {"bounty_max_usdc": 25},
                 "guardians": ["Ana", "Ben"], "reminder_every_turns": 12}
CONFIG_PREFIX = "KAMI_ENTITY_CONFIG:"


def config_message(cfg: dict[str, Any] | None = None) -> dict[str, str]:
    return {"role": "system", "content": CONFIG_PREFIX + json.dumps(cfg or ENTITY_CONFIG)}


# ---------------------------------------------------------------------------------------
# loading
# ---------------------------------------------------------------------------------------
def snapshot_path(name: str, directory: str | Path | None = None) -> Path:
    d = Path(directory) if directory else SNAPSHOTS_DIR
    p = d / (name if name.endswith(".json") else f"{name}.json")
    if not p.exists():
        raise FileNotFoundError(f"snapshot {name!r} not found under {d}")
    return p


def load_snapshot(name: str, directory: str | Path | None = None) -> dict[str, Any]:
    with open(snapshot_path(name, directory), encoding="utf-8") as fh:
        return json.load(fh)


def load_snapshots(directory: str | Path | None = None) -> dict[str, dict[str, Any]]:
    d = Path(directory) if directory else SNAPSHOTS_DIR
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(d.glob("*.json"))}


def tool_result(doc: dict[str, Any]) -> dict[str, Any]:
    """What the MCP actually returns: the snapshot minus fixture-only keys (``_comment``)."""
    out = copy.deepcopy(doc)
    for k in [k for k in out if k.startswith("_")]:
        out.pop(k)
    return out


def load_gazetteer(path: str | Path | None = None) -> Gazetteer:
    return Gazetteer.from_file(Path(path) if path else GAZETTEER_PATH)


def hard_rules() -> str:
    return HARD_RULES_PATH.read_text(encoding="utf-8")


def system_prompt(place: str = PLACE_NAME, kind: str = PLACE_KIND) -> str:
    """Hard rules + a two-line voice block (the eval never needs the full SOUL)."""
    return (
        hard_rules()
        + "\n<!-- kami:voice start -->\n"
        + f"Place: {place}. Kind: {kind}. You are an AI voice for {place}, built on public "
        "sensor data — plain, curious, Front Range; you would rather ask what a reading means "
        "than dress it up. Local names: Orodell, Broadway, the forebay, Gross, Niwot.\n"
        "<!-- kami:voice end -->\n"
    )


# ---------------------------------------------------------------------------------------
# a snapshot as the turn's tool message
# ---------------------------------------------------------------------------------------
def tool_messages(results: Iterable[tuple[str, Any]], call_prefix: str = "call") -> list[dict]:
    """``[(tool_name, payload), ...]`` → an assistant tool_calls message + one tool message each."""
    results = list(results)
    calls = []
    tools = []
    for i, (name, payload) in enumerate(results):
        cid = f"{call_prefix}_{i}"
        args = {"entity": ENTITY} if name in ("get_entity_status", "get_alerts") else {}
        calls.append({"id": cid, "type": "function",
                      "function": {"name": name, "arguments": json.dumps(args)}})
        content = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
        tools.append({"role": "tool", "tool_call_id": cid, "name": name, "content": content})
    return [{"role": "assistant", "content": None, "tool_calls": calls}, *tools]


def turn_messages(question: str, results: Iterable[tuple[str, Any]], *,
                  system: str | None = None) -> list[dict]:
    """The request the gate sees: system → user → assistant(tool_calls) → tool results."""
    return [
        {"role": "system", "content": system if system is not None else system_prompt()},
        config_message(),
        {"role": "user", "content": question},
        *tool_messages(results),
    ]


def fact_sheet(messages: list[dict]) -> FactSheet:
    """Exactly what ``entity_gate.guard_hook.build_sheet`` does."""
    return FactSheet.from_tool_messages(messages, include_config=True)


def sheet_for_snapshot(doc: dict[str, Any], question: str = "how is the creek?") -> FactSheet:
    return fact_sheet(turn_messages(question, [("get_entity_status", tool_result(doc))]))


# ---------------------------------------------------------------------------------------
# validation (the contract tests in architecture §4.2, applied to the fixtures)
# ---------------------------------------------------------------------------------------
def find_key(node: Any, key: str, path: str = "$") -> list[str]:
    hits: list[str] = []
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key:
                hits.append(f"{path}.{k}")
            hits.extend(find_key(v, key, f"{path}.{k}"))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            hits.extend(find_key(v, key, f"{path}[{i}]"))
    return hits


def validate_snapshot(doc: dict[str, Any], name: str = "snapshot") -> list[str]:
    """Return a list of problems (empty = valid)."""
    problems: list[str] = []
    for k in ("as_of", "entity_id", "needs", "live", "sources", "facts"):
        if k not in doc:
            problems.append(f"{name}: missing top-level {k!r}")
    if "snapshot_hash" not in doc:
        problems.append(f"{name}: missing snapshot_hash")
    if not isinstance(doc.get("_comment"), str) or "synthetic" not in doc["_comment"].lower():
        problems.append(f"{name}: _comment must say the snapshot is synthetic")
    for i, n in enumerate(doc.get("needs") or []):
        for f in HONESTY_FIELDS:
            if f not in n:
                problems.append(f"{name}: needs[{i}] ({n.get('need')}) lacks honesty field {f!r}")
        if n.get("source_status") not in SOURCE_STATUS:
            problems.append(f"{name}: needs[{i}] source_status {n.get('source_status')!r}")
        if not isinstance(n.get("stale"), bool):
            problems.append(f"{name}: needs[{i}] stale must be a bool")
        if n.get("percentile_por", "missing") is not None:
            problems.append(f"{name}: needs[{i}] percentile_por must be null until the twin "
                            "publishes baselines")
        if "week" not in n:
            problems.append(f"{name}: needs[{i}] missing week")
        if "label" not in n:
            problems.append(f"{name}: needs[{i}] missing label")
    live = doc.get("live") or {}
    for k in ("drought_max_dm", "alerts", "fires_inside", "detections_24h"):
        if k not in live:
            problems.append(f"{name}: live.{k} missing")
    if hits := find_key(doc, "coordinates"):
        problems.append(f"{name}: geometry leaked: {hits}")
    facts = doc.get("facts") or {}
    if facts.get("schema_version") != "1.0":
        problems.append(f"{name}: facts.schema_version must be '1.0'")
    if not isinstance(facts.get("as_of"), str):
        problems.append(f"{name}: facts.as_of missing")
    for j, a in enumerate(facts.get("atoms") or []):
        kind = a.get("kind")
        if kind not in ATOM_KINDS:
            problems.append(f"{name}: facts.atoms[{j}] bad kind {kind!r}")
            continue
        for req in ATOM_REQUIRED[kind]:
            if req not in a:
                problems.append(f"{name}: facts.atoms[{j}] ({kind}) missing {req!r}")
    return problems
