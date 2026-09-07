"""Read-only onboarding diagnostic. No model, job, publication or control calls."""
from __future__ import annotations

import json
import re
from urllib.parse import urlsplit

from context import Ctx
from net import request
from report import CheckResult, fail, ok, skip, warn
from yamlish import load_yaml

DOC = "scripts/doctor/README.md"
TWIN = "https://mcp.bioregionaltwin.org/mcp"


class McpError(Exception):
    pass


class Mcp:
    """Bounded Streamable HTTP session; never include server text in errors."""
    def __init__(self, url, timeout, token=None):
        self.url, self.timeout, self.seq = url, timeout, 0
        self.headers = {"Accept": "application/json, text/event-stream"}
        if token:
            self.headers["Authorization"] = "Bearer " + token
        result = self.rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
            "clientInfo": {"name": "beings-doctor", "version": "1.0"}})
        version = result.get("protocolVersion") if isinstance(result, dict) else None
        if version not in {"2024-11-05", "2025-03-26", "2025-06-18"}:
            raise McpError("invalid MCP initialization response")
        self.headers["MCP-Protocol-Version"] = version
        self.rpc("notifications/initialized", None, notification=True)

    def rpc(self, method, params=None, notification=False):
        self.seq += 1
        body = {"jsonrpc": "2.0", "method": method}
        if not notification:
            body["id"] = self.seq
        if params is not None:
            body["params"] = params
        response = request(self.url, method="POST", headers=self.headers, body=body,
                           timeout=self.timeout, max_bytes=2 << 20, follow_redirects=False)
        if not response.ok:
            if response.status in (401, 403):
                raise McpError("authentication/authorization rejected (HTTP %s)" % response.status)
            raise McpError("connectivity failure" + (" (HTTP %s)" % response.status if response.status else ""))
        session = next((v for k, v in response.headers.items() if k.lower() == "mcp-session-id"), None)
        if session:
            self.headers["Mcp-Session-Id"] = session
        if notification:
            return None
        payload = response.json()
        if payload is None:
            # SSE can contain keepalives and multiple message events.
            for frame in response.body.decode("utf-8", "replace").replace("\r\n", "\n").split("\n\n"):
                data = "\n".join(line[5:].lstrip() for line in frame.splitlines() if line.startswith("data:"))
                try:
                    candidate = json.loads(data)
                except (ValueError, TypeError):
                    continue
                if isinstance(candidate, dict) and candidate.get("id") == self.seq:
                    payload = candidate
        if not isinstance(payload, dict) or payload.get("id") != self.seq or payload.get("jsonrpc") != "2.0":
            raise McpError("missing or malformed MCP response")
        if "error" in payload or "result" not in payload:
            raise McpError("MCP request failed or result is missing")
        return payload["result"]

    def call(self, name, arguments=None):
        result = self.rpc("tools/call", {"name": name, "arguments": arguments or {}})
        if not isinstance(result, dict) or result.get("isError"):
            raise McpError("MCP tool failed")
        data = result.get("structuredContent")
        if data is None:
            for block in result.get("content", []):
                if isinstance(block, dict) and block.get("type") == "text":
                    try:
                        data = json.loads(block.get("text", ""))
                        break
                    except (ValueError, TypeError):
                        pass
        if not isinstance(data, dict) or data.get("error"):
            raise McpError("missing or invalid MCP tool result")
        return data


def _profile(ctx, version, result):
    name = ctx.get("KAMI_HERMES_PROFILE")
    if not name:
        return
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name):
        result.steps.append(fail("agent.profile", "invalid KAMI_HERMES_PROFILE name", doc=DOC))
        return
    base = ctx.hermes_home() / "profiles" / name
    path = next((base / f for f in ("binding.yaml", "binding.json") if (base / f).is_file()), None)
    if path is None:
        result.steps.append(warn("agent.profile", "explicit Hermes profile has no local binding", doc=DOC,
                                 fix="refresh this profile from the approved connection bundle"))
        return
    try:
        data = load_yaml(path.read_text()) if path.suffix == ".yaml" else json.loads(path.read_text())
        local = data.get("binding_version") if isinstance(data, dict) else None
    except Exception:
        local = None
    if local is None or local != version:
        result.steps.append(warn("agent.profile", "local profile binding is missing, unreadable or differs from the platform",
                                 fix="refresh the dedicated profile; preserve its private credentials", doc=DOC))
    else:
        result.steps.append(ok("agent.profile", "local profile binding version matches the platform"))


def run(ctx: Ctx, prior):
    result = CheckResult(id="agent", title="Agent onboarding — private read-only connection")
    base, token = ctx.platform_url(), ctx.get("PLATFORM_MCP_TOKEN")
    slug = ctx.get("KAMI_ENTITY_SLUG") or ctx.slug
    if not base or not token:
        result.steps.append(skip("agent.config", "PLATFORM_URL or PLATFORM_MCP_TOKEN is not configured",
            fix="set PLATFORM_URL, PLATFORM_MCP_TOKEN and KAMI_ENTITY_SLUG in the private launcher environment", doc=DOC))
        return result
    parsed = urlsplit(base)
    if (parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"})) or parsed.username or parsed.password or parsed.query or parsed.fragment:
        result.steps.append(fail("agent.config", "platform URL must be HTTPS (or loopback HTTP), without credentials, query or fragment", doc=DOC))
        return result
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug):
        result.steps.append(fail("agent.config", "invalid entity slug", doc=DOC))
        return result
    try:
        platform = Mcp(base + "/api/mcp", ctx.timeout, token)
        payload = platform.call("get_entity_config")
        config = payload.get("config")
        if (payload.get("entity_id") != "entity/" + slug or not isinstance(config, dict)
                or not isinstance(config.get("entity"), dict)
                or config["entity"].get("slug") != slug or config["entity"].get("id") != "entity/" + slug):
            raise McpError("token is scoped to a different entity or entity config is malformed")
        if not isinstance(config.get("paused"), bool):
            raise McpError("entity config lacks a valid pause state")
        result.steps.append(ok("agent.platform", "authenticated MCP token matches the requested entity"))
        review, members = config.get("binding_review"), config.get("members")
        version = config.get("binding_version")
        if not isinstance(members, int) or isinstance(members, bool):
            result.steps.append(warn("agent.binding", "sensor membership is unknown; it is not zero", doc=DOC))
        elif review == "approved" and config.get("binding_active") is True:
            result.steps.append(ok("agent.binding", "%s configured places in the approved binding; not a count of live sensors" % members,
                                   binding_version=version, members=members))
        else:
            result.steps.append(warn("agent.binding", "%s proposed/configured places are readable; binding review still gates computed needs" % members,
                fix="review the proposed binding; pending review does not mean sensors are absent", doc=DOC))
        _profile(ctx, version, result)
        needs = platform.call("get_needs_snapshot")
        if needs.get("entity_id") != "entity/" + slug:
            raise McpError("needs response belongs to a different entity or lacks entity identity")
        if "snapshot" not in needs or "snapshot_id" not in needs:
            raise McpError("needs result is missing required snapshot fields")
        snapshot = needs["snapshot"]
        if snapshot is None and needs["snapshot_id"] is None:
            result.steps.append(warn("agent.snapshot", "no computed needs snapshot yet; twin observations may still be available",
                fix="approve the binding and run the platform needs computation", doc=DOC))
        elif not isinstance(snapshot, dict) or not needs.get("snapshot_id") or snapshot.get("entity_id") != "entity/" + slug or not isinstance(snapshot.get("stale_driving"), bool):
            raise McpError("needs snapshot is malformed or belongs to a different entity")
        else:
            result.steps.append(ok("agent.snapshot", "computed needs snapshot is readable", snapshot_id=needs["snapshot_id"]))
            if snapshot.get("stale_driving") is True:
                result.steps.append(warn("agent.freshness", "a driving need is stale; this is a data freshness issue, not an MCP connection failure",
                    fix="inspect source health and timestamps; retain the stale/asleep assessment", doc=DOC))
        result.steps.append(ok("agent.pause", "entity remains paused; private read-only diagnostics are available") if config.get("paused") is True
                            else ok("agent.pause", "entity is not paused"))
    except McpError as exc:
        result.steps.append(fail("agent.platform", str(exc), fix="check the entity-scoped token and production MCP endpoint", doc=DOC))
        return result
    try:
        twin = Mcp(TWIN, ctx.timeout)
        datasets = twin.call("list_datasets")
        if not isinstance(datasets.get("datasets"), list) or not datasets["datasets"]:
            raise McpError("dataset catalog is missing or empty")
        result.steps.append(ok("agent.twin", "public twin dataset catalog is readable"))
        anchor = config.get("anchor")
        if not isinstance(anchor, str) or not anchor.startswith("place/"):
            result.steps.append(warn("agent.anchor", "no valid configured anchor; discover candidate places in the twin", doc=DOC))
        else:
            place = twin.call("get_place", {"id": anchor})
            if place.get("id") != anchor:
                raise McpError("anchor result is missing or identifies a different place")
            readings = place.get("readings")
            if not isinstance(readings, list):
                raise McpError("anchor result lacks a readings list")
            if readings:
                result.steps.append(ok("agent.anchor", "%s anchor observations returned; source timestamps and stale flags remain authoritative" % len(readings),
                                       reading_count=len(readings)))
            else:
                result.steps.append(warn("agent.anchor", "anchor resolves but currently has no observations; this is not an MCP connection failure", doc=DOC))
        result.steps.append(ok("agent.connection", "private platform and twin MCP read path works; no model calls or writes were made"))
    except McpError as exc:
        result.steps.append(fail("agent.twin", str(exc), fix="check the public twin MCP endpoint and configured place ID", doc=DOC))
    result.steps.append(skip("agent.public_runtime", "website chat, guard enforcement, public visibility and learning jobs are not tested by this read-only check",
        fix="complete the separate guarded runtime, evidence and publication readiness checks", doc=DOC))
    return result
