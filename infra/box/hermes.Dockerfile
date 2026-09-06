# Hermes Agent (Nous Research) pinned for Kami — plan T0.3; architecture ADR-E02.
# Docs: https://hermes-agent.nousresearch.com  (the only source cited for Hermes facts).
#
# *verify* (docs/verify.md #1): the exact image name and tag for v0.21.0. The build arg below defaults to
# `v0.21.0`; a third-party changelog calls the same release `v2026.8.31`. Pin whichever the official
# registry publishes, and upgrade monthly behind the eval suite only.
ARG HERMES_IMAGE_TAG=v0.21.0
ARG HERMES_IMAGE=nousresearch/hermes-agent
FROM ${HERMES_IMAGE}:${HERMES_IMAGE_TAG}

# The stdio MCP servers a profile launches need Node 22 (`npx -y @bioregionaltwin/mcp`) and uv
# (`uv run treasury-mcp`). Nothing else is added: no chain tooling, no wallets, no signing libraries.
USER root
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

ARG NODE_MAJOR=22
ARG UV_VERSION=0.9.5
RUN set -eux; \
    if command -v apt-get >/dev/null; then \
      apt-get update; \
      apt-get install -y --no-install-recommends ca-certificates curl gnupg python3 rsync; \
      mkdir -p /etc/apt/keyrings; \
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
      echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list; \
      apt-get update; \
      apt-get install -y --no-install-recommends nodejs; \
      rm -rf /var/lib/apt/lists/*; \
    else \
      echo "base image is not Debian/Ubuntu — adapt the Node 22 install (verify)"; exit 1; \
    fi; \
    node --version | grep -q "^v${NODE_MAJOR}\."

# uv, pinned, from the official static release.
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /uvx /usr/local/bin/

# Warm the npm cache so the first pulse does not wait on the registry (the package is fetched again at
# run time only if the cache misses). Pin to the major the profile template asks for.
RUN npm cache add @bioregionaltwin/mcp@^1 2>/dev/null || echo "twin MCP not on npm yet (TW-2 pending) — skipping cache warm"

ENV HERMES_HOME=/opt/data \
    API_SERVER_ENABLED=true \
    API_SERVER_HOST=127.0.0.1 \
    API_SERVER_PORT=8642 \
    UV_PROJECT=/opt/kami/treasury-mcp \
    NODE_OPTIONS=--max-old-space-size=512

VOLUME ["/opt/data"]
WORKDIR /opt/data

# Drop back to the image's own unprivileged user if it defines one (*verify* the username; `hermes` assumed).
RUN id hermes >/dev/null 2>&1 && chown -R hermes /opt/data || true
USER hermes

# `hermes gateway start` (*verify*) is supplied by docker-compose.yml so the same image serves `hermes cron run`.
