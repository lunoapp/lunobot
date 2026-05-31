---
name: add-google-docs-mcp
description: Add Google Docs/Drive MCP server to the agent container so the bot can read/write Google Workspace docs. Service-account auth via SA JSON mounted from the host. Triggers on "google docs", "google drive", "mcp google".
---

# /add-google-docs-mcp

Adds `@a-bonus/google-docs-mcp` to the container image and wires it as an MCP server per-group, auth via Google Service Account.

## Why

The bot uses `mcp__google-docs__*` tools to read/write Docs and Drive (e.g. fetch a planning doc, write a marketing brief). Without this skill, those tools are unavailable and the agent reports `MCP server disconnected`.

We had this in v1 (Dockerfile pre-install + custom container-runner.ts auto-mounted the SA key). The v1 → v2 migration documented but didn't reapply it. This skill restores the behavior using v2-native extension points (Dockerfile patch + per-group `container.json`).

## Apply (code)

```bash
git fetch origin skill/google-docs-mcp
git merge origin/skill/google-docs-mcp
./container/build.sh   # bakes the binary into the image
```

Conflict-prone line: the ARG block + the install RUN. Marker `# skill/google-docs-mcp` on both.

## Configure (per install)

### 1. Provision the service account

You need a Google Cloud Service Account JSON key with the Docs + Drive APIs enabled and read/write scopes granted to the docs/folders the bot should access.

### 2. Place it on the host

```bash
mkdir -p ~/credentials && chmod 700 ~/credentials
# Drop the SA JSON here:
#   ~/credentials/google-service-account.json   (chmod 600)
```

### 3. Allowlist the mount

Edit `~/.config/nanoclaw/mount-allowlist.json` and add:

```json
{
  "path": "/home/<user>/credentials",
  "allowReadWrite": false,
  "description": "Google SA + GitHub App key (read-only for agent)"
}
```

(Don't add the whole `~/` — too broad. Just the credentials dir.)

Then restart NanoClaw so the allowlist cache reloads.

### 4. Wire each agent group

For every `groups/<folder>/container.json` that should access Google Docs, add:

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "google-docs-mcp",
      "args": [],
      "env": {
        "SERVICE_ACCOUNT_PATH": "/workspace/extra/credentials/google-service-account.json"
      }
    }
  },
  "additionalMounts": [
    {
      "hostPath": "/home/<user>/credentials",
      "containerPath": "credentials",
      "readonly": true
    }
  ]
}
```

Merge alongside any existing `additionalMounts` (e.g. the luno repo mount); both can coexist.

### 5. Stop running containers so the next message picks up the new config

```bash
docker ps --filter name=nanoclaw-v2 --format '{{.Names}}' | xargs -r docker stop
```

## Verify

```bash
# In a fresh chat session, ask the bot:
#   "list deine google-docs MCP tools"
# Expected: it names mcp__google-docs__* tools and demonstrates one read.
```

If the bot reports `MCP server disconnected`, check:
- Container has the binary: `docker run --rm --entrypoint sh nanoclaw-agent-v2-<slug>:latest -c 'which google-docs-mcp'`
- Mount is visible: `docker inspect <container> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'`
- SA file readable in container: `docker exec <container> ls /workspace/extra/credentials/`

## Files touched

| File | Change |
|------|--------|
| `container/Dockerfile` | ARG `GOOGLE_DOCS_MCP_VERSION` + RUN install |

Plus per-install (not in repo): mount-allowlist entry, per-group `container.json` mcpServers/additionalMounts, SA JSON on host.

## Update strategy

When upstream Dockerfile changes, the ARG and RUN lines might drift. Markers (`# skill/google-docs-mcp`) make conflicts obvious.

Bump `GOOGLE_DOCS_MCP_VERSION` deliberately — check the changelog at https://www.npmjs.com/package/@a-bonus/google-docs-mcp before bumping.
