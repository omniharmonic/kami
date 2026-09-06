"""Where the doctor's knowledge of the world comes from, and how it keeps quiet.

Three sources, in this order of precedence: the process environment, then any
`.env` files found next to the repo (they never override a real environment
variable), then `gate.yaml`. Nothing here ever asks for a key it does not have
— every accessor can answer "not configured", and the checks turn that into
`skipped`, never into a guess.

`Secrets` is the other half: every value that looks like a credential is
registered as it is read, and every byte the doctor prints — text and JSON —
passes through `Secrets.redact` on the way out. `--self-test` proves it.
"""

from __future__ import annotations

import os
import re
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from yamlish import load_yaml

SECRET_NAME = re.compile(
    r"(SECRET|TOKEN|PASSWORD|PASSWD|_KEY$|_KEY_|APIKEY|API_KEY|CREDENTIAL|AUTHKEY|DATABASE_URL|DSN)",
    re.IGNORECASE,
)

# Files that may hold configuration, relative to the repo root. Later files do
# not override earlier ones, and none of them override the real environment.
# `infra/mac/kami.env` is deliberately NOT here: .gitignore covers `.env` and
# `.env.*`, not `*.env`, so a secret file at that path would be tracked. The
# Mac's env file lives at ~/.kami/kami.env, read below, outside the repo.
ENV_FILES = (".env", ".env.local", "apps/web/.env.local", "infra/box/.env")
HOME_ENV_FILES = ("~/.kami/kami.env",)


class Secrets:
    """Every secret value the doctor has seen, and the redactor over them."""

    def __init__(self) -> None:
        self._by_value: Dict[str, str] = {}

    def register(self, name: str, value: Optional[str]) -> Optional[str]:
        if value and len(value) >= 6:
            self._by_value.setdefault(value, name)
            # A connection string's password is a secret inside a longer string.
            for part in _password_parts(value):
                if len(part) >= 6:
                    self._by_value.setdefault(part, f"{name}:password")
        return value

    def known(self) -> List[str]:
        return list(self._by_value)

    def redact(self, text: str) -> str:
        if not text:
            return text
        # Longest first, so a secret containing another is masked whole.
        for value in sorted(self._by_value, key=len, reverse=True):
            if value in text:
                text = text.replace(value, f"<redacted:{self._by_value[value]}>")
        return text


def _password_parts(value: str) -> List[str]:
    out: List[str] = []
    try:
        if "://" in value:
            parsed = urllib.parse.urlsplit(value)
            if parsed.password:
                out.append(parsed.password)
    except ValueError:
        pass
    return out


def repo_root(start: Optional[Path] = None) -> Path:
    here = (start or Path(__file__).resolve()).parent
    for candidate in [here] + list(here.parents):
        if (candidate / "CLAUDE.md").exists() and (candidate / "apps").is_dir():
            return candidate
    return Path.cwd()


def parse_env_file(text: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        # strip an inline comment only when the value is unquoted
        if value[:1] not in {'"', "'"}:
            value = value.split(" #", 1)[0].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            out[key] = value
    return out


@dataclass
class Ctx:
    """Everything the checks read, resolved once."""

    slug: str
    root: Path
    env: Dict[str, str]
    secrets: Secrets
    gate_yaml: Dict[str, Any] = field(default_factory=dict)
    gate_yaml_path: Optional[Path] = None
    env_files_read: List[str] = field(default_factory=list)
    timeout: float = 20.0
    notes: List[str] = field(default_factory=list)

    # -- environment ------------------------------------------------------
    def get(self, *names: str, default: Optional[str] = None) -> Optional[str]:
        for name in names:
            value = self.env.get(name)
            if value:
                if SECRET_NAME.search(name):
                    self.secrets.register(name, value)
                return value
        return default

    def source_of(self, *names: str) -> Optional[str]:
        for name in names:
            if self.env.get(name):
                return name
        return None

    # -- gate.yaml --------------------------------------------------------
    def gate(self, *path: str, default: Any = None) -> Any:
        node: Any = self.gate_yaml
        for key in path:
            if not isinstance(node, dict) or key not in node:
                return default
            node = node[key]
        return default if node is None else node

    # -- derived endpoints ------------------------------------------------
    def gate_url(self) -> str:
        explicit = self.get("KAMI_GATE_URL", "GATE_URL")
        if explicit:
            return explicit.rstrip("/")
        listen = str(self.gate("listen", default="127.0.0.1:8001"))
        if listen.startswith("http"):
            return listen.rstrip("/")
        host, _, port = listen.rpartition(":")
        host = host or "127.0.0.1"
        if host in {"0.0.0.0", "::", "[::]"}:
            host = "127.0.0.1"
        return f"http://{host}:{port or '8001'}"

    def gate_admin_secret(self) -> Optional[str]:
        name = str(self.gate("admin_secret_env", default="GATE_ADMIN_SECRET"))
        return self.get(name)

    def platform_url(self) -> Optional[str]:
        url = self.get("KAMI_PLATFORM_URL", "PLATFORM_URL") or self.gate("platform", "base_url")
        if not url:
            pause_set = self.gate("platform", "pause_set_url")
            if isinstance(pause_set, str) and pause_set.startswith("http"):
                url = pause_set.split("/api/", 1)[0]
        if not url:
            url = self.get("BETTER_AUTH_URL")
        return str(url).rstrip("/") if url else None

    def twin_base_url(self) -> Optional[str]:
        return (self.get("TWIN_BASE_URL") or "").rstrip("/") or None

    def twin_tree_dir(self) -> Optional[Path]:
        value = self.get("TWIN_TREE_DIR", "TWIN_TREE")
        if not value:
            return None
        path = Path(value)
        if not path.is_absolute():
            path = (self.root / value).resolve()
        return path

    def hermes_url(self) -> Optional[str]:
        url = self.get("KAMI_HERMES_URL", "HERMES_API_URL", "HERMES_GATEWAY_URL")
        if not url or url.startswith("fake:"):
            return None
        return url.rstrip("/")

    def hermes_home(self) -> Path:
        value = self.get("HERMES_HOME")
        return Path(value).expanduser() if value else Path.home() / ".hermes"

    def contact(self) -> str:
        return self.get("KAMI_PULSE_CONTACT", default="hello@kami.invalid") or "hello@kami.invalid"

    def data_dir(self) -> Optional[Path]:
        value = self.get("KAMI_DATA_DIR")
        if not value:
            return None
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = (self.root / value).resolve()
        return path

    def anchor_place(self) -> Optional[str]:
        """The entity's anchor id, read from `profiles/<slug>/binding.yaml`."""
        binding = self.root / "profiles" / self.slug / "binding.yaml"
        if not binding.exists():
            return None
        try:
            data = load_yaml(binding.read_text(encoding="utf-8"))
        except Exception:
            return None
        if isinstance(data, dict):
            anchor = data.get("anchor")
            if isinstance(anchor, str) and anchor:
                return anchor
        return None


def build_context(slug: str, timeout: float = 20.0, environ: Optional[Dict[str, str]] = None) -> Ctx:
    root = repo_root()
    secrets = Secrets()
    env: Dict[str, str] = dict(environ if environ is not None else os.environ)
    files_read: List[str] = []
    notes: List[str] = []

    candidates_env: List[tuple] = [(rel, root / rel) for rel in ENV_FILES]
    candidates_env += [(rel, Path(rel).expanduser()) for rel in HOME_ENV_FILES]
    for rel, path in candidates_env:
        if not path.is_file():
            continue
        try:
            parsed = parse_env_file(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        files_read.append(rel)
        for key, value in parsed.items():
            env.setdefault(key, value)

    # Register everything credential-shaped up front: a secret can only be
    # redacted if the redactor has seen it, and a check may print a value it
    # read for another reason entirely.
    for key, value in env.items():
        if SECRET_NAME.search(key):
            secrets.register(key, value)

    gate_path: Optional[Path] = None
    gate_data: Dict[str, Any] = {}
    candidates: List[Path] = []
    explicit = env.get("KAMI_GATE_YAML")
    if explicit:
        candidates.append(Path(explicit).expanduser())
    candidates += [
        root / "apps" / "gate" / "gate.yaml",
        root / "infra" / "mac" / "gate.yaml",
        Path.home() / ".kami" / "gate.yaml",
        root / "infra" / "box" / "gate.yaml",
    ]
    for candidate in candidates:
        if candidate.is_file():
            try:
                loaded = load_yaml(candidate.read_text(encoding="utf-8"))
            except Exception as exc:  # a broken gate.yaml is a finding, not a crash
                notes.append(f"note: {candidate} did not parse ({exc}); treating it as absent.")
                continue
            if isinstance(loaded, dict):
                gate_path = candidate
                gate_data = loaded
                break

    return Ctx(
        slug=slug,
        root=root,
        env=env,
        secrets=secrets,
        gate_yaml=gate_data,
        gate_yaml_path=gate_path,
        env_files_read=files_read,
        timeout=timeout,
        notes=notes,
    )
