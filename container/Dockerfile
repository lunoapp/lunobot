# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation

FROM node:22-slim

# Prevent Coolify's DockerCleanupJob from deleting this image.
# Coolify prunes all images without this label nightly at 00:00 UTC.
LABEL coolify.managed=true

# Install system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libcups2 \
    libdrm2 \
    libxshmfence1 \
    curl \
    git \
    imagemagick \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Install agent-browser, claude-code, and Google Docs MCP globally
# Pre-installing avoids npx download on every container start (network-dependent, slow)
RUN npm install -g agent-browser @anthropic-ai/claude-code @a-bonus/google-docs-mcp

# Install GitHub MCP server (Go binary, provides GitHub API tools for the agent)
RUN curl -fsSL https://github.com/github/github-mcp-server/releases/latest/download/github-mcp-server_Linux_x86_64.tar.gz \
    | tar -xz -C /usr/local/bin github-mcp-server

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Container input (prompt, group info) is passed via stdin JSON.
# Credentials are injected by the host's credential proxy — never passed here.
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
# Create GitHub App token helper (generates installation token from private key)
COPY github-app-token.mjs /app/github-app-token.mjs

# Apple Container only supports directory mounts (VirtioFS), so .env cannot be
# shadowed with a host-side /dev/null file mount. Instead the entrypoint starts
# as root, uses mount --bind to shadow .env, then drops to the host user via setpriv.
RUN printf '#!/bin/bash\nset -e\n\n# Shadow .env so the agent cannot read host secrets (requires root)\nif [ "$(id -u)" = "0" ] && [ -f /workspace/project/.env ]; then\n  mount --bind /dev/null /workspace/project/.env\nfi\n\n# Source credentials file if mounted (read-only, not in env vars)\nif [ -f "${NANOCLAW_CREDENTIALS_FILE:-}" ]; then\n  source "$NANOCLAW_CREDENTIALS_FILE"\nfi\n# Write Google service account key file from base64 env var if available\nif [ -n "${GOOGLE_SERVICE_ACCOUNT_KEY:-}" ]; then\n  echo "$GOOGLE_SERVICE_ACCOUNT_KEY" | base64 -d > /tmp/google-sa-key.json\n  export SERVICE_ACCOUNT_PATH=/tmp/google-sa-key.json\nfi\n# Generate GitHub App installation token if credentials are available\nif [ -n "${GITHUB_APP_PRIVATE_KEY:-}" ] && [ -n "${GITHUB_APP_ID:-}" ] && [ -n "${GITHUB_APP_INSTALLATION_ID:-}" ]; then\n  GITHUB_TOKEN=$(node /app/github-app-token.mjs 2>/dev/null)\n  if [ -n "$GITHUB_TOKEN" ]; then\n    export GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"\n  fi\nfi\n\n# Compile agent-runner\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\n\n# Capture stdin to temp file\ncat > /tmp/input.json\n\n# Drop privileges if running as root (main-group containers)\nif [ "$(id -u)" = "0" ] && [ -n "$RUN_UID" ]; then\n  chown "$RUN_UID:$RUN_GID" /tmp/input.json /tmp/dist\n  exec setpriv --reuid="$RUN_UID" --regid="$RUN_GID" --clear-groups -- node /tmp/dist/index.js < /tmp/input.json\nfi\n\nexec node /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
