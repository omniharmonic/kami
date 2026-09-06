"""`kami doctor --self-test` — prove the tool cannot leak a key.

The doctor reads API keys, admin secrets, tokens and a database URL with a
password in it, and prints a great deal about what it found. One mistake there
turns a diagnostic into a credential dump — pasted into an issue, a chat, a
screenshot.

So this runs the whole doctor in a child process with a recognisable fake
secret in every credential-shaped variable, in both text and JSON modes, and
asserts that none of those values appears anywhere in stdout or stderr. It
needs no network: the checks fail or skip, and their failure messages are
exactly the output most likely to quote a value back.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

CANARIES = {
    "OPENAI_API_KEY": "sk-doctor-canary-openai-000000000001",
    "KAMI_UPSTREAM_API_KEY": "sk-doctor-canary-upstream-00000002",
    "GATE_ADMIN_SECRET": "doctor-canary-gate-admin-000000003",
    "PLATFORM_MCP_TOKEN": "doctor-canary-platform-mcp-0000004",
    "PLATFORM_ADMIN_TOKEN": "doctor-canary-platform-admin-00005",
    "HERMES_API_SERVER_KEY": "doctor-canary-hermes-key-00000006",
    "CRON_SECRET": "doctor-canary-cron-secret-0000007",
    "R2_SECRET_ACCESS_KEY": "doctor-canary-r2-secret-00000008",
    "R2_ACCESS_KEY_ID": "doctor-canary-r2-access-00000009",
    "BETTER_AUTH_SECRET": "doctor-canary-better-auth-000010",
    "STRIPE_SECRET_KEY": "sk_test_doctor_canary_stripe_0011",
    "DATABASE_URL": "postgres://kami:doctor-canary-db-password-12@db.invalid.test/kami",
}
DB_PASSWORD = "doctor-canary-db-password-12"


def main() -> int:
    here = Path(__file__).resolve().parent
    env = dict(os.environ)
    env.update(CANARIES)
    # Point everything at addresses that cannot answer, so the run is fast and
    # every check produces its "not configured" or "unreachable" wording.
    env.update(
        {
            # A positive control: the API key's value is planted inside a field
            # the doctor definitely prints (the upstream base URL). If the
            # redactor were a no-op this run would leak it, so this proves the
            # test can fail rather than merely passing by never printing.
            "KAMI_UPSTREAM_URL": "http://127.0.0.1:9/" + CANARIES["OPENAI_API_KEY"],
            "KAMI_GATE_URL": "http://127.0.0.1:9",
            "PLATFORM_URL": "http://127.0.0.1:9",
            "HERMES_GATEWAY_URL": "http://127.0.0.1:9",
            "KAMI_PUBLIC_GATEWAY_URL": "https://gw.invalid.test",
            "TWIN_BASE_URL": "http://127.0.0.1:9",
            "KAMI_DATA_BASE_URL": "http://127.0.0.1:9",
            "R2_ACCOUNT_ID": "doctorcanaryaccount",
            "R2_BUCKET": "kami-doctor-canary",
        }
    )

    failures = []
    for mode in (["--timeout", "2"], ["--json", "--timeout", "2"]):
        proc = subprocess.run(
            [sys.executable, str(here / "main.py"), *mode],
            capture_output=True,
            env=env,
            timeout=600,
        )
        blob = proc.stdout.decode("utf-8", "replace") + proc.stderr.decode("utf-8", "replace")
        for name, value in CANARIES.items():
            if value in blob:
                failures.append(f"{name} leaked in `kami doctor {' '.join(mode)}` output")
        if DB_PASSWORD in blob:
            failures.append(f"the DATABASE_URL password leaked in `kami doctor {' '.join(mode)}` output")
        if not blob.strip():
            failures.append(f"`kami doctor {' '.join(mode)}` produced no output at all")
        if "<redacted:" not in blob:
            failures.append(
                f"`kami doctor {' '.join(mode)}` printed no redaction marker — the planted key should have "
                "appeared in the upstream URL and been masked; the redactor may not be running at all"
            )

    if failures:
        for line in failures:
            print("FAIL " + line)
        return 1
    print(f"ok   {len(CANARIES)} canary secrets, text and JSON: none appeared in the output")
    print("ok   a key planted inside a printed field came out as <redacted:…> (the test can fail)")
    print("ok   the DATABASE_URL password is masked separately from the URL")
    return 0


if __name__ == "__main__":
    sys.exit(main())
