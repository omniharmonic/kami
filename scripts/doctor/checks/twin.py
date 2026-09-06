"""3. The twin — the only place a kami's numbers may come from.

Kami reads the twin's published tree the way a browser does (`docs/planning`
§4; README rule 5). This check does the same four GETs the platform's hourly
job does, and then prints the anchor place's most recent reading with its age,
so the operator sees real measured data with their own eyes before believing
anything the model says about it.

A fixture tree (`TWIN_TREE_DIR`) is read when it is configured, and reported as
a warning rather than a pass: fixtures are an all-stale 2026-09-06 build and
prove the plumbing, not the world.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from context import Ctx
from net import request
from report import CheckResult, Step, fail, human_age, ok, skip, warn
from timeutil import parse_iso

DOC = "packages/twin-mcp/README.md; docs/deploy/first-entity.md checkpoint 2"

CONDITIONS_WARN_S = 90 * 60
CONDITIONS_FAIL_S = 6 * 3600


def _fetch(ctx: Ctx, base: Optional[str], tree_dir: Optional[Path], rel: str) -> Tuple[Optional[Any], str]:
    """Returns (parsed json | None, error string)."""
    if base:
        resp = request(
            f"{base}/{rel}",
            headers={"User-Agent": f"kami-doctor/1.0 ({ctx.contact()})"},
            timeout=min(ctx.timeout, 30),
            max_bytes=8 << 20,
        )
        if not resp.ok:
            return None, resp.why()
        data = resp.json()
        if data is None:
            return None, f"{rel} did not parse as JSON"
        return data, ""
    if tree_dir:
        path = tree_dir / rel
        if not path.exists():
            return None, f"{path} does not exist"
        try:
            return json.loads(path.read_text(encoding="utf-8")), ""
        except Exception as exc:
            return None, f"{path} did not parse: {exc}"
    return None, "no tree configured"


def run(ctx: Ctx, prior: Dict[str, CheckResult]) -> CheckResult:
    result = CheckResult(id="twin", title="Twin — the measured world")
    base = ctx.twin_base_url()
    tree_dir = ctx.twin_tree_dir()

    if not base and not tree_dir:
        result.steps.append(
            skip(
                "twin.config",
                "neither TWIN_BASE_URL nor TWIN_TREE_DIR is set",
                fix="export TWIN_BASE_URL=https://data.bioregionaltwin.org (production), or TWIN_TREE_DIR="
                "packages/twin-mcp/fixtures/public to work against the fixture tree",
                doc=DOC,
            )
        )
        return result

    if base:
        result.steps.append(ok("twin.config", f"live tree {base} (contact {ctx.contact()})", tree=base))
    else:
        result.steps.append(
            warn(
                "twin.config",
                f"reading the fixture tree at {tree_dir}, not the live twin",
                fix="the fixtures are an all-stale synthetic 2026-09-06 build; set TWIN_BASE_URL="
                "https://data.bioregionaltwin.org before you believe any reading below",
                doc=DOC,
            )
        )

    index, err = _fetch(ctx, base, tree_dir, "id/index.json")
    if index is None:
        result.steps.append(
            fail(
                "twin.reachable",
                f"id/index.json could not be read: {err}",
                fix="check outbound HTTPS and the host: `curl -sSI "
                f"{(base or 'https://data.bioregionaltwin.org')}/id/index.json`. If the twin is down, the platform "
                "keeps serving the last status.json and the page renders asleep — that is correct behaviour, not a "
                "bug to work around",
                doc=DOC,
            )
        )
        return result

    places: List[Dict[str, Any]] = []
    if isinstance(index, dict) and isinstance(index.get("places"), list):
        places = [p for p in index["places"] if isinstance(p, dict)]
    if not places:
        result.steps.append(
            fail(
                "twin.index",
                "id/index.json parsed but carries no places[]",
                fix="the tree's shape changed; compare with packages/twin-mcp/fixtures/public/id/index.json and "
                "docs/research/twin-survey.md",
                doc=DOC,
            )
        )
        return result
    generated = index.get("generated_at") if isinstance(index, dict) else None
    result.steps.append(
        ok(
            "twin.index",
            f"{len(places)} ids, generated {generated or 'unknown'}",
            count=len(places),
            generated_at=generated,
        )
    )

    anchor = ctx.anchor_place()
    if not anchor:
        result.steps.append(
            skip(
                "twin.anchor",
                f"no anchor found — profiles/{ctx.slug}/binding.yaml is missing or has no `anchor:`",
                fix=f"create profiles/{ctx.slug}/binding.yaml (architecture §3) or run the doctor with "
                "--slug boulder-creek",
                doc="profiles/README.md",
            )
        )
        return result

    ids = {p.get("id") for p in places}
    if anchor not in ids:
        result.steps.append(
            fail(
                "twin.anchor",
                f"the anchor {anchor} is not in the twin's id index",
                fix=f"the id was renamed or superseded. Look it up in {base or tree_dir}/id/index.json and update "
                f"profiles/{ctx.slug}/binding.yaml; the nightly binding-check job drafts the successor version",
                doc="profiles/README.md; docs/verify.md #32-#33",
            )
        )
        return result
    anchor_name = next((p.get("name") for p in places if p.get("id") == anchor), anchor)
    result.steps.append(ok("twin.anchor", f"{anchor} — {anchor_name}", anchor=anchor))

    conditions, err = _fetch(ctx, base, tree_dir, "latest/conditions.json")
    if conditions is None or not isinstance(conditions, dict):
        result.steps.append(
            fail(
                "twin.conditions",
                f"latest/conditions.json could not be read: {err or 'unexpected shape'}",
                fix="without it the hourly needs job has nothing to compute; check the twin's own health board at "
                f"{(base or 'https://data.bioregionaltwin.org')}/latest/health.json",
                doc=DOC,
            )
        )
        return result

    now = time.time()
    gen = conditions.get("generated_at")
    gen_epoch = parse_iso(gen)
    age = (now - gen_epoch) if gen_epoch else None
    detail = f"generated {gen} ({human_age(age)} ago)"
    if age is None:
        result.steps.append(
            warn("twin.conditions", f"generated_at {gen!r} could not be parsed", fix="", doc=DOC)
        )
    elif age > CONDITIONS_FAIL_S:
        result.steps.append(
            fail(
                "twin.conditions",
                detail + " — too old to drive anything",
                fix="the twin's publisher has stopped. Check its health board and say so publicly; the kami will "
                "render asleep, which is honest",
                doc=DOC,
            )
        )
    elif age > CONDITIONS_WARN_S:
        result.steps.append(
            warn(
                "twin.conditions",
                detail + " — older than the hourly build should be",
                fix="usually a slow upstream source rather than the twin; check latest/health.json",
                doc=DOC,
            )
        )
    else:
        result.steps.append(ok("twin.conditions", detail, generated_at=gen, age_s=age))

    stations = conditions.get("stations") or []
    station = next((s for s in stations if isinstance(s, dict) and s.get("id") == anchor), None)
    if station is None:
        result.steps.append(
            warn(
                "twin.reading",
                f"the anchor {anchor} publishes no station block in latest/conditions.json",
                fix="the gauge may be seasonal, retired or superseded; the entity's flow need will read stale and "
                "the avatar will sleep. Check id/" + anchor + ".json for `superseded_by`",
                doc=DOC,
            )
        )
        return result

    readings = [r for r in (station.get("readings") or []) if isinstance(r, dict)]
    if not readings:
        result.steps.append(
            warn(
                "twin.reading",
                f"{anchor} is in the tree but published no readings in this build",
                fix="nothing to do here — the platform renders 'I can't feel my gauge'. Watch it for a day",
                doc=DOC,
            )
        )
        return result

    def reading_epoch(r: Dict[str, Any]) -> float:
        return parse_iso(r.get("time")) or 0.0

    newest = max(readings, key=reading_epoch)
    r_epoch = reading_epoch(newest)
    r_age = (now - r_epoch) if r_epoch else None
    value = newest.get("value")
    unit = newest.get("unit")
    prop = newest.get("property")
    stale = bool(newest.get("stale"))
    detail = (
        f"{station.get('name', anchor)}: {prop} {value} {unit} at {newest.get('time')} "
        f"({human_age(r_age)} old, source {newest.get('source_id')}, source_status "
        f"{newest.get('source_status', 'unknown')})"
    )
    if stale:
        result.steps.append(
            warn(
                "twin.reading",
                detail + " — flagged stale",
                fix="stale is not sad: a stale driving need forces mood `asleep` and the page says \"I can't feel my "
                "gauge\". Nothing to fix here unless the source itself is down — check the twin's health board",
                doc=DOC,
                reading=newest,
            )
        )
    else:
        result.steps.append(ok("twin.reading", detail, reading=newest))
    return result
