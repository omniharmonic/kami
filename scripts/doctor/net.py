"""HTTP, SSE, DNS and TCP, in the standard library only.

Every call returns a `Resp` instead of raising: a check needs to say *how* the
network failed (refused, timed out, TLS, 401) and a traceback says none of that.
"""

from __future__ import annotations

import http.client
import json
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Tuple

USER_AGENT = "kami-doctor/1.0"


@dataclass
class Resp:
    status: int = 0
    body: bytes = b""
    headers: Dict[str, str] = field(default_factory=dict)
    error: str = ""
    elapsed_s: float = 0.0
    url: str = ""

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300 and not self.error

    def text(self, limit: int = 4000) -> str:
        try:
            return self.body.decode("utf-8", "replace")[:limit]
        except Exception:
            return ""

    def json(self) -> Optional[Any]:
        if not self.body:
            return None
        try:
            return json.loads(self.body.decode("utf-8", "replace"))
        except Exception:
            return None

    def why(self) -> str:
        """One clause naming what went wrong, for a failure sentence."""
        if self.error:
            return self.error
        if self.status:
            snippet = self.text(200).replace("\n", " ").strip()
            return f"HTTP {self.status}{(' — ' + snippet) if snippet else ''}"
        return "no response"


def request(
    url: str,
    method: str = "GET",
    headers: Optional[Dict[str, str]] = None,
    body: Any = None,
    timeout: float = 20.0,
    max_bytes: int = 1 << 20,
) -> Resp:
    """One request. `body` may be bytes, str or a JSON-serialisable object."""
    hdrs = {"User-Agent": USER_AGENT, "Accept": "application/json, */*"}
    hdrs.update(headers or {})
    data: Optional[bytes] = None
    if body is not None:
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        elif isinstance(body, str):
            data = body.encode("utf-8")
        else:
            data = json.dumps(body).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - explicit URLs only
            payload = resp.read(max_bytes)
            return Resp(
                status=resp.status,
                body=payload,
                headers={k.lower(): v for k, v in resp.headers.items()},
                elapsed_s=time.time() - started,
                url=url,
            )
    except urllib.error.HTTPError as exc:
        payload = b""
        try:
            payload = exc.read(max_bytes)
        except Exception:
            pass
        return Resp(
            status=exc.code,
            body=payload,
            headers={k.lower(): v for k, v in (exc.headers or {}).items()},
            elapsed_s=time.time() - started,
            url=url,
        )
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, socket.timeout):
            msg = f"timed out after {timeout:.0f}s"
        elif isinstance(reason, ssl.SSLError):
            msg = f"TLS error: {reason}"
        elif isinstance(reason, ConnectionRefusedError):
            msg = "connection refused (nothing is listening)"
        else:
            msg = f"unreachable: {reason}"
        return Resp(error=msg, elapsed_s=time.time() - started, url=url)
    except socket.timeout:
        return Resp(error=f"timed out after {timeout:.0f}s", elapsed_s=time.time() - started, url=url)
    except Exception as exc:  # last resort: still a finding, never a traceback
        return Resp(error=f"{type(exc).__name__}: {exc}", elapsed_s=time.time() - started, url=url)


def stream_sse(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    body: Any = None,
    timeout: float = 60.0,
    max_frames: int = 4000,
) -> Tuple[Resp, List[str]]:
    """POST and read `text/event-stream` frames as they arrive.

    Returns the response envelope (status/headers, body left empty) and the raw
    `data:` payload lines in order. Used to prove streaming really streams and
    that the gate's trailing frames arrive.
    """
    hdrs = {"User-Agent": USER_AGENT, "Accept": "text/event-stream"}
    hdrs.update(headers or {})
    data = json.dumps(body).encode("utf-8") if body is not None and not isinstance(body, (bytes, str)) else body
    if isinstance(data, str):
        data = data.encode("utf-8")
    if data is not None:
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=hdrs, method="POST")
    started = time.time()
    frames: List[str] = []
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            envelope = Resp(
                status=resp.status,
                headers={k.lower(): v for k, v in resp.headers.items()},
                url=url,
            )
            for raw in resp:
                line = raw.decode("utf-8", "replace").rstrip("\n").rstrip("\r")
                if line.startswith("data:"):
                    frames.append(line[5:].strip())
                elif line.startswith("event:"):
                    frames.append("\x00event:" + line[6:].strip())
                if len(frames) >= max_frames:
                    break
            envelope.elapsed_s = time.time() - started
            return envelope, frames
    except urllib.error.HTTPError as exc:
        payload = b""
        try:
            payload = exc.read(1 << 18)
        except Exception:
            pass
        return (
            Resp(
                status=exc.code,
                body=payload,
                headers={k.lower(): v for k, v in (exc.headers or {}).items()},
                elapsed_s=time.time() - started,
                url=url,
            ),
            frames,
        )
    except Exception as exc:
        return Resp(error=f"{type(exc).__name__}: {exc}", elapsed_s=time.time() - started, url=url), frames


def sse_events(frames: List[str]) -> Iterator[Tuple[Optional[str], str]]:
    """`(event_name, data)` pairs from the raw frame list."""
    pending: Optional[str] = None
    for frame in frames:
        if frame.startswith("\x00event:"):
            pending = frame[len("\x00event:") :]
            continue
        yield pending, frame
        pending = None


def tcp_open(host: str, port: int, timeout: float = 3.0) -> Tuple[bool, str]:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, "open"
    except socket.timeout:
        return False, "filtered (timed out)"
    except ConnectionRefusedError:
        return False, "closed (refused)"
    except OSError as exc:
        return False, f"unreachable ({exc.strerror or exc})"


def local_addresses() -> List[str]:
    """Every address this machine answers on, so 'reachable' can be interrogated."""
    out = {"127.0.0.1", "::1"}
    try:
        host = socket.gethostname()
        for family, _, _, _, sockaddr in socket.getaddrinfo(host, None):
            if family in (socket.AF_INET, socket.AF_INET6):
                out.add(sockaddr[0])
    except OSError:
        pass
    return sorted(out)


def resolve(hostname: str) -> List[str]:
    try:
        infos = socket.getaddrinfo(hostname, None)
    except OSError:
        return []
    return sorted({info[4][0] for info in infos})


def resolve_public(hostname: str, timeout: float = 8.0) -> Tuple[List[str], str]:
    """Resolve through Cloudflare's DoH endpoint — a name server that is not this LAN.

    Returns (addresses, error). An empty list with no error means NXDOMAIN: the
    name exists nowhere but here.
    """
    query = urllib.parse.urlencode({"name": hostname, "type": "A"})
    resp = request(
        f"https://cloudflare-dns.com/dns-query?{query}",
        headers={"Accept": "application/dns-json"},
        timeout=timeout,
    )
    if not resp.ok:
        return [], resp.why()
    data = resp.json() or {}
    answers = data.get("Answer") or []
    addrs = [a.get("data") for a in answers if a.get("type") in (1, 5) and a.get("data")]
    return [a for a in addrs if a], ""


def host_port(url: str, default_port: Optional[int] = None) -> Tuple[str, int]:
    parts = urllib.parse.urlsplit(url)
    port = parts.port or default_port or (443 if parts.scheme == "https" else 80)
    return parts.hostname or "", port


def is_local_host(hostname: str) -> bool:
    """True when a hostname can only mean 'this machine or this LAN'."""
    h = (hostname or "").lower().strip("[]")
    if h in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}:
        return True
    if h.endswith(".local") or h.endswith(".internal") or h.endswith(".lan"):
        return True
    if h.startswith("10.") or h.startswith("192.168.") or h.startswith("169.254."):
        return True
    if h.startswith("172."):
        try:
            second = int(h.split(".")[1])
            if 16 <= second <= 31:
                return True
        except (IndexError, ValueError):
            pass
    if h.startswith("100."):  # CGNAT / tailnet range
        try:
            second = int(h.split(".")[1])
            if 64 <= second <= 127:
                return True
        except (IndexError, ValueError):
            pass
    if h.endswith(".ts.net"):  # a tailnet name is not the public internet
        return True
    return False


def http_conn_probe(url: str, timeout: float = 5.0) -> Tuple[int, Dict[str, str], str]:
    """A HEAD-like probe that keeps the response headers even on a redirect."""
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    port = parts.port or (443 if parts.scheme == "https" else 80)
    path = parts.path or "/"
    try:
        if parts.scheme == "https":
            conn: http.client.HTTPConnection = http.client.HTTPSConnection(host, port, timeout=timeout)
        else:
            conn = http.client.HTTPConnection(host, port, timeout=timeout)
        conn.request("GET", path, headers={"User-Agent": USER_AGENT})
        resp = conn.getresponse()
        headers = {k.lower(): v for k, v in resp.getheaders()}
        status = resp.status
        resp.read(2048)
        conn.close()
        return status, headers, ""
    except Exception as exc:
        return 0, {}, f"{type(exc).__name__}: {exc}"
