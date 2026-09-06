"""The smallest correct AWS SigV4 signer, for R2's S3 API.

Cloudflare R2 speaks S3 with region `auto`. Signing a request needs nothing but
`hashlib` and `hmac`, so the doctor can prove the bucket is writable without
adding a dependency — and, more to the point, without ever printing the key.

Only what is needed here: a single request, payload hashed in memory, no
chunked uploads, no presigning.
"""

from __future__ import annotations

import datetime
import hashlib
import hmac
import urllib.parse
from typing import Dict, Optional, Tuple

SERVICE = "s3"
ALGORITHM = "AWS4-HMAC-SHA256"


def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret: str, date: str, region: str) -> bytes:
    k_date = _sign(("AWS4" + secret).encode("utf-8"), date)
    k_region = _sign(k_date, region)
    k_service = _sign(k_region, SERVICE)
    return _sign(k_service, "aws4_request")


def sign(
    method: str,
    url: str,
    access_key: str,
    secret_key: str,
    payload: bytes = b"",
    region: str = "auto",
    now: Optional[datetime.datetime] = None,
    extra_headers: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """Headers (including Authorization) for one signed S3 request."""
    parts = urllib.parse.urlsplit(url)
    host = parts.netloc
    path = urllib.parse.quote(parts.path or "/", safe="/~")
    query = parts.query or ""
    stamp = (now or datetime.datetime.now(datetime.timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    date = stamp[:8]
    payload_hash = hashlib.sha256(payload).hexdigest()

    headers: Dict[str, str] = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": stamp,
    }
    for key, value in (extra_headers or {}).items():
        headers[key.lower()] = value

    signed_names = ";".join(sorted(headers))
    canonical_headers = "".join(f"{k}:{headers[k].strip()}\n" for k in sorted(headers))
    canonical_query = "&".join(sorted(query.split("&"))) if query else ""
    canonical_request = "\n".join(
        [method.upper(), path, canonical_query, canonical_headers, signed_names, payload_hash]
    )
    scope = f"{date}/{region}/{SERVICE}/aws4_request"
    to_sign = "\n".join(
        [ALGORITHM, stamp, scope, hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()]
    )
    signature = hmac.new(_signing_key(secret_key, date, region), to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    out = {k: v for k, v in headers.items() if k != "host"}
    out["Authorization"] = (
        f"{ALGORITHM} Credential={access_key}/{scope}, SignedHeaders={signed_names}, Signature={signature}"
    )
    return out


def endpoint_for(account_id: Optional[str], explicit: Optional[str]) -> Optional[str]:
    if explicit:
        return explicit.rstrip("/")
    if account_id:
        return f"https://{account_id}.r2.cloudflarestorage.com"
    return None


def object_url(endpoint: str, bucket: str, key: str) -> Tuple[str, str]:
    """(url, key) — path-style, which R2 accepts and needs no DNS per bucket."""
    quoted = urllib.parse.quote(key, safe="/")
    return f"{endpoint.rstrip('/')}/{bucket}/{quoted}", key
