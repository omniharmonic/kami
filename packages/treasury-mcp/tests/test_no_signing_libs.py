"""The server holds no key and imports no signing library (CLAUDE.md invariant, T2.4, X.1)."""

from __future__ import annotations

import importlib.metadata as md
import sys
import tomllib
from pathlib import Path

import treasury_mcp  # noqa: F401  — import first so sys.modules reflects the package

FORBIDDEN = ("eth_account", "web3", "eth_keys", "safe_eth", "eth_abi", "coincurve", "ecdsa", "bip_utils")
PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def _normalize(name: str) -> str:
    return name.lower().replace("-", "_").split("[")[0].strip()


def _requirement_name(req: str) -> str:
    return _normalize(req.split(";")[0].split(" ")[0].split("=")[0].split("<")[0].split(">")[0].split("~")[0])


def test_declared_dependencies_contain_no_signing_library():
    deps = tomllib.loads(PYPROJECT.read_text())["project"]["dependencies"]
    names = {_requirement_name(d) for d in deps}
    assert names == {"mcp", "httpx", "pydantic"}
    assert not names & set(FORBIDDEN)


def test_transitive_dependency_tree_contains_no_signing_library():
    seen: set[str] = set()
    stack = ["mcp", "httpx", "pydantic"]
    while stack:
        name = stack.pop()
        if name in seen:
            continue
        seen.add(name)
        try:
            reqs = md.requires(name) or []
        except md.PackageNotFoundError:
            continue
        for r in reqs:
            if ";" in r and "extra ==" in r:
                continue  # optional extras are not installed by our declaration
            stack.append(_requirement_name(r))
    assert not seen & set(FORBIDDEN), seen & set(FORBIDDEN)


def test_no_signing_module_loaded_after_import():
    loaded = {m.split(".")[0] for m in sys.modules}
    assert not loaded & set(FORBIDDEN)


def test_package_source_never_mentions_a_key():
    src = Path(treasury_mcp.__file__).parent
    for f in src.glob("*.py"):
        text = f.read_text()
        for needle in ("private_key", "PRIVATE_KEY", "SAFE_PROPOSER_KEY", "sign_transaction", "signTransaction"):
            assert needle not in text, f"{f.name} mentions {needle}"
