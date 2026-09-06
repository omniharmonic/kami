"""The seven checks, in dependency order. Each module exposes
`run(ctx, prior) -> CheckResult` and never raises: a check that cannot run
returns `skipped`, and one that crashes is caught in `main.py`.
"""
