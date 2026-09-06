"""A tiny YAML subset reader, used only when PyYAML is not importable.

`gate.yaml` is a plain mapping of scalars, nested mappings, block lists of
scalars and inline `[]` / `{}` flows with comments. That is all this parses.
If PyYAML is available (it is inside the repo's uv venv) `load_yaml` uses it
instead, so the doctor never disagrees with the gate about its own config.

Anything this parser cannot understand becomes a string; it never raises on
odd input, because a doctor that crashes on a config file is useless exactly
when you need it.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple


def load_yaml(text: str) -> Any:
    try:  # pragma: no cover - depends on the interpreter the wrapper picked
        import yaml  # type: ignore

        return yaml.safe_load(text)
    except Exception:
        return parse(text)


def _scalar(raw: str) -> Any:
    s = raw.strip()
    if s == "" or s in {"~", "null", "Null", "NULL"}:
        return None
    if s in {"true", "True", "yes", "on"}:
        return True
    if s in {"false", "False", "no", "off"}:
        return False
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    if s.startswith("[") and s.endswith("]"):
        inner = s[1:-1].strip()
        return [_scalar(p) for p in _split_flow(inner)] if inner else []
    if s.startswith("{") and s.endswith("}"):
        inner = s[1:-1].strip()
        out: Dict[str, Any] = {}
        for part in _split_flow(inner):
            if ":" in part:
                k, v = part.split(":", 1)
                out[k.strip()] = _scalar(v)
        return out
    try:
        if s.startswith("0") and s not in {"0"} and not s.startswith("0."):
            return s  # keep zero-padded things (HUC codes) as strings
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        return s


def _split_flow(inner: str) -> List[str]:
    parts: List[str] = []
    depth = 0
    cur = ""
    quote = ""
    for ch in inner:
        if quote:
            cur += ch
            if ch == quote:
                quote = ""
            continue
        if ch in "\"'":
            quote = ch
            cur += ch
            continue
        if ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur)
            cur = ""
            continue
        cur += ch
    if cur.strip():
        parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def _strip_comment(line: str) -> str:
    out = ""
    quote = ""
    prev = ""
    for ch in line:
        if quote:
            out += ch
            if ch == quote:
                quote = ""
            prev = ch
            continue
        if ch in "\"'":
            quote = ch
            out += ch
            prev = ch
            continue
        if ch == "#" and (prev in {" ", "\t", ""}):
            break
        out += ch
        prev = ch
    return out.rstrip()


def parse(text: str) -> Any:
    lines: List[Tuple[int, str]] = []
    for raw in text.splitlines():
        body = _strip_comment(raw)
        if not body.strip():
            continue
        indent = len(body) - len(body.lstrip(" "))
        lines.append((indent, body.strip()))
    value, _ = _block(lines, 0, 0)
    return value


def _block(lines: List[Tuple[int, str]], i: int, indent: int) -> Tuple[Any, int]:
    if i >= len(lines):
        return None, i
    if lines[i][1].startswith("- "):
        items: List[Any] = []
        while i < len(lines) and lines[i][0] >= indent and lines[i][1].startswith("- "):
            items.append(_scalar(lines[i][1][2:]))
            i += 1
        return items, i
    out: Dict[str, Any] = {}
    while i < len(lines):
        cur_indent, body = lines[i]
        if cur_indent < indent:
            break
        if ":" not in body:
            i += 1
            continue
        key, _, rest = body.partition(":")
        key = key.strip()
        rest = rest.strip()
        if rest:
            out[key] = _scalar(rest)
            i += 1
            continue
        # a nested block, or an empty value
        if i + 1 < len(lines) and lines[i + 1][0] > cur_indent:
            child, i = _block(lines, i + 1, lines[i + 1][0])
            out[key] = child
        elif i + 1 < len(lines) and lines[i + 1][0] == cur_indent and lines[i + 1][1].startswith("- "):
            child, i = _block(lines, i + 1, cur_indent)
            out[key] = child
        else:
            out[key] = None
            i += 1
    return out, i
