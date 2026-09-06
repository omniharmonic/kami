"""4. The platform — the public half, and the two doors the box knocks on.

The web app is the only thing the public sees, and it holds two credentials the
box depends on: the entity's own `PLATFORM_MCP_TOKEN` (the pulse precheck and
the treasury MCP use it) and the gate's shared secret (the pause set). Both are
proved here against the running deployment, because a token that is merely
"set" proves nothing.

`status.json` is checked last: it is what the page renders when the box is off,
so its `as_of` age is the honest measure of whether the hourly job is alive.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, Optional

from context import Ctx
from net import request
from report import CheckResult, Step, fail, human_age, ok, skip, warn
from timeutil import parse_iso

DOC = "apps/web/README.md; docs/deploy/vercel.md"
STATUS_WARN_S = 2 * 3600
STATUS_FAIL_S = 24 * 3600


def _status_document(ctx: Ctx) -> tuple[Optional[Dict[str, Any]], str, str]:
    """(document, where it came from, error)."""
    base = ctx.get("KAMI_DATA_BASE_URL")
    rel = f"entity/{ctx.slug}/status.json"
    if base:
        url = f"{base.rstrip('/')}/{rel}"
        resp = request(url, timeout=min(ctx.timeout, 20))
        if resp.ok:
            data = resp.json()
            if isinstance(data, dict):
                return data, url, ""
            return None, url, "the object is not JSON"
        return None, url, resp.why()
    data_dir = ctx.data_dir()
    if data_dir:
        for candidate in (data_dir / rel, data_dir / f"{ctx.slug}.json"):
            if candidate.exists():
                try:
                    return json.loads(candidate.read_text(encoding="utf-8")), str(candidate), ""
                except Exception as exc:
                    return None, str(candidate), f"did not parse: {exc}"
        return None, str(data_dir / rel), "no status file there yet"
    return None, "", "neither KAMI_DATA_BASE_URL nor KAMI_DATA_DIR is set"


def run(ctx: Ctx, prior: Dict[str, CheckResult]) -> CheckResult:
    result = CheckResult(id="platform", title="Platform — the public site and its two doors")
    base = ctx.platform_url()

    if not base:
        result.steps.append(
            skip(
                "platform.config",
                "no platform URL is configured",
                fix="export PLATFORM_URL=https://<your Vercel deployment> (or BETTER_AUTH_URL); locally that is "
                "http://127.0.0.1:3000 with `pnpm --filter @kami/web dev` running",
                doc=DOC,
            )
        )
        return result
    result.steps.append(ok("platform.config", base, base_url=base))

    root = request(base + "/", timeout=min(ctx.timeout, 20))
    if root.status == 0:
        result.steps.append(
            fail(
                "platform.reachable",
                f"{base}/ did not answer: {root.why()}",
                fix="if this is Vercel, check the deployment is not paused and the domain resolves; if it is local, "
                "start `pnpm --filter @kami/web dev`",
                doc=DOC,
            )
        )
        return result
    result.steps.append(ok("platform.reachable", f"HTTP {root.status} from {base}/", status=root.status))

    # ---- the entity token --------------------------------------------------
    entity_token = ctx.get("PLATFORM_MCP_TOKEN")
    admin_token = ctx.get("PLATFORM_ADMIN_TOKEN")
    token = entity_token or admin_token
    token_name = "PLATFORM_MCP_TOKEN" if entity_token else ("PLATFORM_ADMIN_TOKEN" if admin_token else None)
    state_url = f"{base}/api/entities/{ctx.slug}/state"
    if not token:
        result.steps.append(
            skip(
                "platform.state",
                "no PLATFORM_MCP_TOKEN in the environment, so the entity's own door was not tried",
                fix="mint one on the platform (admin → profiles) and put it in the profile's .env and in "
                "~/.kami/kami.env; it is what the pulse precheck and the treasury MCP authenticate with",
                doc=DOC,
            )
        )
    else:
        resp = request(state_url, headers={"Authorization": f"Bearer {token}"}, timeout=min(ctx.timeout, 20))
        if resp.status == 401:
            result.steps.append(
                fail(
                    "platform.state",
                    f"{state_url} refused ${token_name}",
                    fix="the token is for a different entity or was rotated; mint a new one on the platform and "
                    f"redeploy the profile (`pnpm --filter @kami/profile-scripts run deploy-profile {ctx.slug}`)",
                    doc=DOC,
                )
            )
        elif resp.status == 404:
            result.steps.append(
                fail(
                    "platform.state",
                    f"the platform has no entity {ctx.slug}",
                    fix="create it first — the summon flow, or the admin screen; the slug in the database must match "
                    "the profile slug exactly",
                    doc=DOC,
                )
            )
        elif resp.status == 503:
            result.steps.append(
                fail(
                    "platform.state",
                    "the platform answered 503 no_database",
                    fix="DATABASE_URL is unset or unreachable on the deployment; set it in the Vercel project and "
                    "redeploy (see docs/deploy/vercel.md)",
                    doc=DOC,
                )
            )
        elif not resp.ok:
            result.steps.append(
                fail("platform.state", f"{state_url}: {resp.why()}", fix="see the deployment's logs", doc=DOC)
            )
        else:
            data = resp.json() or {}
            result.steps.append(
                ok(
                    "platform.state",
                    f"{data.get('slug')} · paused={data.get('paused')} retired={data.get('retired')} "
                    f"gpu_online={data.get('gpu_online')} (token ${token_name})",
                    state=data,
                )
            )

    # ---- the gate's door ---------------------------------------------------
    secret = ctx.gate_admin_secret()
    pause_url = f"{base}/api/gate/pause-set"
    configured_pause_url = ctx.gate("platform", "pause_set_url")
    if not secret:
        result.steps.append(
            skip(
                "platform.pause_set",
                "GATE_ADMIN_SECRET is not set here, so the gate's door was not tried",
                fix="the same secret must be in the gate's environment and in the platform's; export it here to "
                "prove the two match",
                doc=DOC,
            )
        )
    else:
        resp = request(pause_url, headers={"X-Gate-Admin": secret}, timeout=min(ctx.timeout, 20))
        if resp.status == 401:
            result.steps.append(
                fail(
                    "platform.pause_set",
                    "the platform refused this GATE_ADMIN_SECRET — the gate and the platform hold different values",
                    fix="set the same value in the Vercel project (GATE_ADMIN_SECRET) and in ~/.kami/kami.env, "
                    "then restart the gate. Until they match, a guardian's pause never reaches the box",
                    doc=DOC,
                )
            )
        elif resp.status == 503:
            result.steps.append(
                fail(
                    "platform.pause_set",
                    "the platform answered 503 no_database, so it cannot serve a pause set",
                    fix="set DATABASE_URL on the deployment",
                    doc=DOC,
                )
            )
        elif not resp.ok:
            result.steps.append(
                fail("platform.pause_set", f"{pause_url}: {resp.why()}", fix="see the deployment's logs", doc=DOC)
            )
        else:
            data = resp.json() or {}
            paused = data.get("paused")
            result.steps.append(
                ok(
                    "platform.pause_set",
                    f"answered for the gate's secret; {len(paused) if isinstance(paused, list) else '?'} paused, "
                    f"as_of {data.get('as_of')}",
                    pause_set=data,
                )
            )

    if not configured_pause_url:
        result.steps.append(
            warn(
                "platform.pause_wiring",
                "gate.yaml has `platform.pause_set_url: null` — the gate never polls the platform, so a pause made "
                "on the website does not reach it",
                fix=f"set platform.pause_set_url: {pause_url} in gate.yaml (and platform.fail_closed: true), then "
                "restart the gate",
                doc="apps/gate/README.md",
            )
        )
    else:
        result.steps.append(ok("platform.pause_wiring", f"gate polls {configured_pause_url}"))

    # ---- status.json -------------------------------------------------------
    doc, where, err = _status_document(ctx)
    if doc is None:
        result.steps.append(
            warn(
                "platform.status_json",
                f"no status.json for {ctx.slug} ({err}) at {where or 'nowhere configured'}",
                fix="run the hourly job once: `curl -s -X POST \"$PLATFORM_URL/api/cron/needs?slug="
                f"{ctx.slug}\" -H \"Authorization: Bearer $CRON_SECRET\"`. Until it exists the page has nothing to "
                "render when the box is off",
                doc="infra/vercel.crons.md",
            )
        )
        return result
    as_of = doc.get("as_of") or (doc.get("snapshot") or {}).get("as_of")
    epoch = parse_iso(as_of if isinstance(as_of, str) else None)
    age = (time.time() - epoch) if epoch else None
    snapshot = doc.get("snapshot") if isinstance(doc.get("snapshot"), dict) else {}
    mood = snapshot.get("mood") or doc.get("mood")
    detail = f"{where} · as_of {as_of} ({human_age(age)} ago)" + (f" · mood {mood}" if mood else "")
    if age is None:
        result.steps.append(warn("platform.status_json", detail + " — no parseable as_of", doc=DOC))
    elif age > STATUS_FAIL_S:
        result.steps.append(
            fail(
                "platform.status_json",
                detail + " — the hourly needs job has not published for a day",
                fix="check the Vercel cron log for /api/cron/needs and that CRON_SECRET is set on the deployment",
                doc="infra/vercel.crons.md",
            )
        )
    elif age > STATUS_WARN_S:
        result.steps.append(
            warn(
                "platform.status_json",
                detail + " — older than the hourly build",
                fix="one missed run is normal; two is the cron or the twin",
                doc="infra/vercel.crons.md",
            )
        )
    else:
        result.steps.append(ok("platform.status_json", detail, as_of=as_of, age_s=age, mood=mood))
    return result
