"""7. Database and object storage — where the record and the page live.

Two independent things, checked together because they fail the same way (a
credential that is present but wrong):

* **Neon** — reachable, and the migrations applied. Reachability is a TCP
  connect (no driver needed); the migration count needs SQL, so it uses `psql`
  when it is installed and says `skipped` rather than guessing when it is not.
* **Object storage** — R2 when it is configured, otherwise the local data dir
  that stands in for it. Writable is proved by writing: a small probe object is
  PUT, read back, and deleted. Then the entity's real `status.json` is read
  back the way a browser would read it, because a bucket that accepts writes
  and serves nothing is the more common failure.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.parse
from pathlib import Path
from typing import Dict, List, Optional

import sigv4
from context import Ctx
from net import request, tcp_open
from report import CheckResult, Step, fail, human_age, ok, skip, warn
from timeutil import parse_iso

DOC = "docs/deploy/vercel.md; infra/neon/; apps/web/src/lib/publish/r2.ts"


# ---------------------------------------------------------------------------
# Neon
# ---------------------------------------------------------------------------


def _database_steps(ctx: Ctx) -> List[Step]:
    steps: List[Step] = []
    url = ctx.get("DATABASE_URL")
    if not url:
        steps.append(
            skip(
                "db.config",
                "DATABASE_URL is not set",
                fix="create the Neon project and put the pooled connection string in the environment (and in the "
                "Vercel project); see docs/deploy/vercel.md",
                doc=DOC,
            )
        )
        return steps

    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    port = parts.port or 5432
    steps.append(ok("db.config", f"{host}:{port} database {(parts.path or '/').lstrip('/') or 'unknown'}", host=host))

    opened, how = tcp_open(host, port, timeout=min(ctx.timeout, 10))
    if not opened:
        steps.append(
            fail(
                "db.reachable",
                f"cannot open {host}:{port} — {how}",
                fix="check the Neon project is not suspended and that the connection string is the pooled one "
                "(`-pooler` in the host). From this Mac: `nc -vz " + host + f" {port}`",
                doc=DOC,
            )
        )
        return steps
    steps.append(ok("db.reachable", f"{host}:{port} accepts connections"))

    local_migrations = sorted((ctx.root / "apps" / "web" / "src" / "db" / "migrations").glob("*.sql"))
    psql = shutil.which("psql")
    if not psql:
        steps.append(
            skip(
                "db.migrations",
                f"psql is not installed, so the applied count could not be read ({len(local_migrations)} migration "
                "files in the repo)",
                fix="`brew install libpq && brew link --force libpq` to get psql, or just apply them: "
                "`pnpm --filter @kami/web db:migrate` (idempotent)",
                doc=DOC,
            )
        )
        return steps

    env = dict(os.environ)
    env.setdefault("PGCONNECT_TIMEOUT", "10")
    try:
        proc = subprocess.run(
            [
                psql,
                url,
                "-At",
                "-c",
                "select coalesce((select count(*)::text from drizzle.__drizzle_migrations), 'no-table')",
            ],
            capture_output=True,
            timeout=45,
            env=env,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        steps.append(
            warn("db.migrations", f"psql could not run: {exc}", fix="run the migration command by hand", doc=DOC)
        )
        return steps

    out = proc.stdout.decode("utf-8", "replace").strip()
    err = proc.stderr.decode("utf-8", "replace").strip()
    if proc.returncode != 0:
        steps.append(
            fail(
                "db.migrations",
                f"psql could not query the database: {err.splitlines()[-1] if err else 'unknown error'}",
                fix="check the role in DATABASE_URL can read; then `pnpm --filter @kami/web db:migrate`",
                doc=DOC,
            )
        )
        return steps
    if out == "no-table" or not out:
        steps.append(
            fail(
                "db.migrations",
                f"no migrations have been applied ({len(local_migrations)} are waiting in the repo)",
                fix="`DATABASE_URL=… pnpm --filter @kami/web db:migrate` — it is idempotent and safe to re-run",
                doc=DOC,
            )
        )
        return steps
    try:
        applied = int(out)
    except ValueError:
        steps.append(warn("db.migrations", f"unexpected answer from psql: {out[:80]}", doc=DOC))
        return steps
    if applied < len(local_migrations):
        steps.append(
            fail(
                "db.migrations",
                f"{applied} migrations applied, {len(local_migrations)} in the repo",
                fix="`pnpm --filter @kami/web db:migrate`",
                doc=DOC,
            )
        )
    else:
        steps.append(
            ok("db.migrations", f"{applied} applied ({len(local_migrations)} in the repo)", applied=applied)
        )
    return steps


# ---------------------------------------------------------------------------
# object storage
# ---------------------------------------------------------------------------


def _r2_steps(ctx: Ctx) -> List[Step]:
    steps: List[Step] = []
    account = ctx.get("R2_ACCOUNT_ID")
    access = ctx.get("R2_ACCESS_KEY_ID")
    secret = ctx.get("R2_SECRET_ACCESS_KEY")
    bucket = ctx.get("R2_BUCKET")
    endpoint = sigv4.endpoint_for(account, ctx.get("R2_ENDPOINT"))

    if not (access and secret and bucket and endpoint):
        return steps  # caller falls back to the local dir

    steps.append(ok("storage.config", f"R2 bucket {bucket} at {endpoint}", bucket=bucket, endpoint=endpoint))
    key = f"entity/{ctx.slug}/.kami-doctor-probe.json"
    payload = json.dumps({"written_by": "kami doctor", "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}).encode()
    url, _ = sigv4.object_url(endpoint, bucket, key)

    put_headers = sigv4.sign("PUT", url, access, secret, payload, extra_headers={"content-type": "application/json"})
    put_headers["content-type"] = "application/json"
    put = request(url, method="PUT", headers=put_headers, body=payload, timeout=min(ctx.timeout, 30))
    if put.status in (401, 403):
        steps.append(
            fail(
                "storage.write",
                f"R2 refused the write ({put.status})",
                fix="check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY and that the token has Object Read & Write on "
                f"{bucket}",
                doc=DOC,
            )
        )
        return steps
    if not put.ok:
        steps.append(
            fail(
                "storage.write",
                f"could not write a probe object: {put.why()}",
                fix="check R2_ACCOUNT_ID / R2_ENDPOINT and the bucket name",
                doc=DOC,
            )
        )
        return steps

    get_headers = sigv4.sign("GET", url, access, secret, b"")
    got = request(url, headers=get_headers, timeout=min(ctx.timeout, 30))
    delete_headers = sigv4.sign("DELETE", url, access, secret, b"")
    request(url, method="DELETE", headers=delete_headers, timeout=min(ctx.timeout, 30))
    if got.ok:
        steps.append(ok("storage.write", f"wrote, read back and deleted {key}"))
    else:
        steps.append(
            warn(
                "storage.write",
                f"the write succeeded but the read back did not ({got.why()})",
                fix="the token may be write-only; give it Object Read & Write",
                doc=DOC,
            )
        )
    return steps


def _local_steps(ctx: Ctx) -> List[Step]:
    steps: List[Step] = []
    data_dir = ctx.data_dir()
    if not data_dir:
        steps.append(
            skip(
                "storage.config",
                "no object storage configured (no R2 keys, no KAMI_DATA_DIR)",
                fix="either set the R2 variables (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET) "
                "or KAMI_DATA_DIR=./data-local for a local stand-in",
                doc=DOC,
            )
        )
        return steps
    steps.append(ok("storage.config", f"local data dir {data_dir} (stand-in for R2)", path=str(data_dir)))
    probe_dir = data_dir / "entity" / ctx.slug
    probe = probe_dir / ".kami-doctor-probe"
    try:
        probe_dir.mkdir(parents=True, exist_ok=True)
        probe.write_text("kami doctor\n", encoding="utf-8")
        probe.read_text(encoding="utf-8")
        probe.unlink()
        steps.append(ok("storage.write", f"{probe_dir} is writable"))
    except OSError as exc:
        steps.append(
            fail(
                "storage.write",
                f"{probe_dir} is not writable: {exc}",
                fix="create it and fix its ownership, or point KAMI_DATA_DIR somewhere the gate's user can write",
                doc=DOC,
            )
        )
    return steps


def _readback_steps(ctx: Ctx) -> List[Step]:
    """The published status.json, read the way the page reads it."""
    base = ctx.get("KAMI_DATA_BASE_URL")
    rel = f"entity/{ctx.slug}/status.json"
    if base:
        url = f"{base.rstrip('/')}/{rel}"
        resp = request(url, timeout=min(ctx.timeout, 20))
        if resp.status == 404:
            return [
                warn(
                    "storage.readback",
                    f"{url} is 404 — nothing has been published for {ctx.slug} yet",
                    fix="run the hourly job once: `curl -s -X POST \"$PLATFORM_URL/api/cron/needs?slug="
                    f"{ctx.slug}\" -H \"Authorization: Bearer $CRON_SECRET\"`",
                    doc="infra/vercel.crons.md",
                )
            ]
        if not resp.ok:
            return [
                fail(
                    "storage.readback",
                    f"{url}: {resp.why()}",
                    fix="check the bucket's public access setting and that KAMI_DATA_BASE_URL points at the public "
                    "r2.dev URL or the custom domain in front of it",
                    doc=DOC,
                )
            ]
        doc = resp.json() or {}
        as_of = doc.get("as_of") if isinstance(doc, dict) else None
        epoch = parse_iso(as_of if isinstance(as_of, str) else None)
        age = (time.time() - epoch) if epoch else None
        cache = resp.headers.get("cache-control", "")
        return [
            ok(
                "storage.readback",
                f"{url} · as_of {as_of} ({human_age(age)} ago)" + (f" · cache-control {cache}" if cache else ""),
                as_of=as_of,
                cache_control=cache,
            )
        ]
    data_dir = ctx.data_dir()
    if not data_dir:
        return [
            skip(
                "storage.readback",
                "no KAMI_DATA_BASE_URL and no local data dir, so nothing could be read back",
                fix="set KAMI_DATA_BASE_URL to the bucket's public base URL",
                doc=DOC,
            )
        ]
    path = data_dir / rel
    if not path.exists():
        return [
            warn(
                "storage.readback",
                f"{path} does not exist yet",
                fix="run the hourly needs job once, then look again",
                doc="infra/vercel.crons.md",
            )
        ]
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return [
            fail(
                "storage.readback",
                f"{path} did not parse: {exc}",
                fix="delete it and let the hourly job republish",
                doc=DOC,
            )
        ]
    as_of = doc.get("as_of") if isinstance(doc, dict) else None
    epoch = parse_iso(as_of if isinstance(as_of, str) else None)
    age = (time.time() - epoch) if epoch else None
    return [ok("storage.readback", f"{path} · as_of {as_of} ({human_age(age)} ago)", as_of=as_of)]


def run(ctx: Ctx, prior: Dict[str, CheckResult]) -> CheckResult:
    result = CheckResult(id="storage", title="Database and object storage")
    result.steps.extend(_database_steps(ctx))
    r2 = _r2_steps(ctx)
    result.steps.extend(r2 if r2 else _local_steps(ctx))
    result.steps.extend(_readback_steps(ctx))
    return result
