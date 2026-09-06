"""6. The tunnel — reachable from outside, not just from here.

This is the failure that looks like success. A Mac mini on a home network has
no inbound port forwarding and should never get any: the tunnel is an outbound
connection the Mac makes to Cloudflare, and Cloudflare hands requests back down
it. So `curl http://127.0.0.1:8642` succeeding proves nothing about whether
Vercel can reach the gateway — and if you only ever test from the Mac, the site
will render "I'm asleep" while every local check passes.

Three things are asked here, and the answers are reported separately because
they fail separately:

* is the URL the *platform* is configured with a public one at all (a loopback
  or tailnet address here is an immediate fail);
* does that hostname resolve on a name server that is not this LAN (Cloudflare
  DoH — an independent vantage point);
* does the request reach it, and did it visibly travel through the tunnel's
  edge (a `cf-ray` header, or an address that is not one of this machine's).

When the last one cannot be proven, this says so in plain words rather than
calling it a pass.

Also asserted: the tunnel exposes **only** the Hermes API port. If 8000 or 8001
answer on the public hostname, that is a finding, not a convenience.
"""

from __future__ import annotations

import urllib.parse
from typing import Dict, List, Optional

from context import Ctx
from net import host_port, http_conn_probe, is_local_host, local_addresses, request, resolve, resolve_public
from report import CheckResult, Step, fail, ok, skip, warn

DOC = "infra/mac/cloudflared/README.md; docs/runbooks/box.md 'The tunnel dropped'; docs/verify.md #16"


def run(ctx: Ctx, prior: Dict[str, CheckResult]) -> CheckResult:
    result = CheckResult(id="tunnel", title="Tunnel — can the platform actually reach this Mac?")

    # What the *platform* is configured with, not what is convenient locally.
    public_url = ctx.get("KAMI_PUBLIC_GATEWAY_URL", "PLATFORM_HERMES_GATEWAY_URL")
    source = ctx.source_of("KAMI_PUBLIC_GATEWAY_URL", "PLATFORM_HERMES_GATEWAY_URL")
    if not public_url:
        candidate = ctx.get("HERMES_GATEWAY_URL")
        if candidate and not candidate.startswith("fake:"):
            public_url, source = candidate, "HERMES_GATEWAY_URL"

    if not public_url:
        result.steps.append(
            skip(
                "tunnel.config",
                "no public gateway URL is configured, so there is nothing to reach from outside",
                fix="set the tunnel hostname the Vercel project uses — export KAMI_PUBLIC_GATEWAY_URL="
                "https://gw.<your domain> here, and set HERMES_GATEWAY_URL to the same value in Vercel",
                doc=DOC,
            )
        )
        return result

    host, port = host_port(public_url)
    scheme = urllib.parse.urlsplit(public_url).scheme
    result.steps.append(ok("tunnel.config", f"{public_url} (from ${source})", url=public_url))

    if is_local_host(host):
        result.steps.append(
            fail(
                "tunnel.external",
                f"the platform's gateway URL is {host} — a loopback, LAN or tailnet address. Vercel cannot reach "
                "it, however well it works from this Mac",
                fix="run cloudflared and point the platform at the tunnel hostname: `cloudflared tunnel run kami-gw` "
                "with infra/mac/cloudflared/config.yml, then set HERMES_GATEWAY_URL=https://gw.<domain> in the "
                "Vercel project. No port forwarding is needed and none should be added",
                doc=DOC,
            )
        )
        return result

    # 1. does the name exist off this network?
    public_addrs, dns_err = resolve_public(host, timeout=min(ctx.timeout, 10))
    local_addrs = resolve(host)
    if dns_err:
        result.steps.append(
            warn(
                "tunnel.dns",
                f"could not ask a public resolver about {host} ({dns_err}); this machine resolves it to "
                f"{', '.join(local_addrs) or 'nothing'}",
                fix="check this Mac's own outbound HTTPS; without an independent resolver, 'reachable' below is only "
                "a local claim",
                doc=DOC,
            )
        )
    elif not public_addrs:
        result.steps.append(
            fail(
                "tunnel.dns",
                f"{host} does not resolve on a public name server (it resolves to "
                f"{', '.join(local_addrs) or 'nothing'} here)",
                fix="add the DNS record — for a Cloudflare tunnel that is `cloudflared tunnel route dns kami-gw "
                f"{host}`, which creates the CNAME for you",
                doc=DOC,
            )
        )
        return result
    else:
        result.steps.append(
            ok("tunnel.dns", f"{host} resolves publicly to {', '.join(public_addrs)}", addresses=public_addrs)
        )

    # 2. does it answer, and did the answer come from the edge?
    key = ctx.get("HERMES_API_SERVER_KEY", "API_SERVER_KEY")
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    reached: Optional[int] = None
    edge_headers: Dict[str, str] = {}
    for path in ("/api/health", "/v1/models", "/"):
        resp = request(public_url.rstrip("/") + path, headers=headers, timeout=min(ctx.timeout, 15))
        if resp.status:
            reached = resp.status
            edge_headers = resp.headers
            break
    if reached is None:
        status, hdrs, err = http_conn_probe(public_url.rstrip("/") + "/", timeout=min(ctx.timeout, 10))
        reached, edge_headers = (status or None), hdrs
        if reached is None:
            result.steps.append(
                fail(
                    "tunnel.external",
                    f"{public_url} did not answer from this machine either ({err})",
                    fix="check the tunnel is running (`launchctl list | grep cloudflared`, or "
                    "`cloudflared tunnel info kami-gw`) and that Hermes is up on 127.0.0.1:8642. "
                    "docs/runbooks/box.md 'The tunnel dropped' is the order to work through",
                    doc=DOC,
                )
            )
            return result

    through_edge = any(h in edge_headers for h in ("cf-ray", "cf-cache-status")) or "cloudflare" in (
        edge_headers.get("server", "").lower()
    )
    off_box = bool(public_addrs) and not set(public_addrs) & set(local_addresses())

    if reached in (401, 403) and through_edge:
        result.steps.append(
            ok(
                "tunnel.external",
                f"the edge answered {reached} — the request reached the tunnel and the API key or the Access "
                "policy refused it, which still proves the path",
                status=reached,
            )
        )
    elif through_edge:
        result.steps.append(
            ok("tunnel.external", f"HTTP {reached} through the Cloudflare edge (cf-ray present)", status=reached)
        )
    elif off_box:
        result.steps.append(
            warn(
                "tunnel.external",
                f"HTTP {reached} from an address that is not this machine, but nothing in the response says it "
                "came through a tunnel edge",
                fix="probably fine; to be certain, ask something outside this network: "
                f"`curl -sSI {public_url}` from a phone on cellular, or the Vercel deployment's own logs",
                doc=DOC,
            )
        )
    else:
        result.steps.append(
            fail(
                "tunnel.external",
                f"{public_url} answered {reached}, but only from this machine — nothing proves it is reachable "
                "from the internet. This is the failure that looks like success: local checks pass and the site "
                "still renders 'I'm asleep'",
                fix="start the tunnel (`cloudflared tunnel run kami-gw`) and confirm from a device off this "
                f"network: `curl -sSI {public_url}`",
                doc=DOC,
            )
        )

    # 3. nothing but the gateway may be exposed
    exposed: List[str] = []
    if scheme == "https" and port == 443:
        from net import tcp_open

        for probe_port, name in ((8000, "vLLM"), (8001, "the gate"), (8642, "the Hermes API")):
            opened, _ = tcp_open(host, probe_port, timeout=3.0)
            if opened:
                exposed.append(f"{probe_port} ({name})")
        if exposed:
            result.steps.append(
                fail(
                    "tunnel.exposure",
                    f"{host} accepts connections on {', '.join(exposed)} — the tunnel must expose the Hermes API "
                    "and nothing else",
                    fix="remove the extra ingress rules from infra/mac/cloudflared/config.yml and any port "
                    "forwarding on the router. Never widen exposure to debug something",
                    doc=DOC,
                )
            )
        else:
            result.steps.append(ok("tunnel.exposure", "8000, 8001 and 8642 are not reachable directly — only 443"))
    else:
        result.steps.append(
            warn(
                "tunnel.exposure",
                f"the gateway URL names port {port} directly rather than a tunnel on 443",
                fix="a home network should not forward ports; put the gateway behind cloudflared so the Mac makes "
                "an outbound connection instead",
                doc=DOC,
            )
        )
    return result
