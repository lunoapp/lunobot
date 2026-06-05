---
name: add-google-docs-mcp
description: Add Google Docs/Drive/Sheets MCP server to the agent container. Auth via OneCLI-managed OAuth (Apps Framework). Triggers on "google docs", "google drive", "mcp google".
---

# /add-google-docs-mcp

Wires `@a-bonus/google-docs-mcp` into agent containers. Real OAuth tokens stay in the OneCLI vault; the container only sees `"onecli-managed"` placeholders. The gateway swaps placeholders for real Bearer tokens at request time.

## Apply (code)

```bash
git fetch origin skill/google-docs-mcp
git merge origin/skill/google-docs-mcp
./container/build.sh
```

Patches `container/Dockerfile` to install `@a-bonus/google-docs-mcp@${GOOGLE_DOCS_MCP_VERSION}` globally. Marker `# skill/google-docs-mcp` on the ARG and RUN lines.

## Configure (per install)

### 1. OneCLI ≥ 1.33 (Apps Framework)

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:10254/api/apps
```

Expected: `200`. If `404`, OneCLI is too old — upgrade via the Coolify-managed compose at `/data/coolify/services/<onecli-uuid>/docker-compose.yml` (or the OneCLI install script).

### 2. Connect Google apps via Web UI

OneCLI Web UI is bound to `127.0.0.1:10254`. From a workstation:

```bash
ssh -L 10254:127.0.0.1:10254 <host>
```

Browser → `http://localhost:10254` → **Connections** → for each of **Google Drive**, **Google Docs**, **Google Sheets**:

- Toggle **"Use your own developer credentials"** ON
- Paste the same `client_id` + `client_secret` from a GCP OAuth Client (Desktop type — accepts `http://localhost:*` redirect URIs without explicit config)
- **Save credentials** → **Connect** → OAuth flow as the target account → grant scopes

After all three are connected: `curl http://127.0.0.1:10254/api/apps | python3 -c '...'` should show `status=connected` on each.

### 3. Per-agent secret mode

```bash
onecli agents list
onecli agents set-secret-mode --id <agent-id> --mode all
```

`mode=all` means matching app connections auto-inject into the agent's containers. `selective` would require explicit per-agent app linking.

### 4. Stub credentials on host

`@a-bonus/google-docs-mcp` reads its token from `~/.config/google-docs-mcp/token.json`. With OneCLI-managed pattern, that file holds only sentinel values:

```bash
mkdir -p ~nanoclaw/.config/google-docs-mcp
cat > ~nanoclaw/.config/google-docs-mcp/token.json <<'JSON'
{
  "access_token": "onecli-managed",
  "refresh_token": "onecli-managed",
  "token_type": "Bearer",
  "expiry_date": 99999999999999,
  "scope": "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets"
}
JSON
chown -R nanoclaw:nanoclaw ~nanoclaw/.config/google-docs-mcp
chmod 700 ~nanoclaw/.config/google-docs-mcp
chmod 600 ~nanoclaw/.config/google-docs-mcp/token.json
```

`expiry_date` is set to far future so the MCP server never tries to refresh the placeholder.

### 5. Mount allowlist

Add to `~nanoclaw/.config/nanoclaw/mount-allowlist.json` under `allowedRoots`:

```json
{
  "path": "/home/nanoclaw/.config/google-docs-mcp",
  "allowReadWrite": false,
  "description": "Google Docs MCP stub (OneCLI-managed real tokens)"
}
```

Restart the NanoClaw service so the cached allowlist reloads.

### 6. Per-group `container.json`

For each group that should get Google access:

```json
{
  "mcpServers": {
    "google-docs": {
      "command": "google-docs-mcp",
      "args": [],
      "env": {
        "GOOGLE_CLIENT_ID": "onecli-managed",
        "GOOGLE_CLIENT_SECRET": "onecli-managed",
        "HOME": "/workspace/extra"
      }
    }
  },
  "additionalMounts": [
    {
      "hostPath": "/home/nanoclaw/.config/google-docs-mcp",
      "containerPath": ".config/google-docs-mcp",
      "readonly": false
    }
  ]
}
```

`HOME=/workspace/extra` is what makes the MCP server resolve `~/.config/google-docs-mcp/token.json` to `/workspace/extra/.config/google-docs-mcp/token.json` — the path the mount lands at. The matching `containerPath: ".config/google-docs-mcp"` (note the subdir, not a flat name) is critical.

### 7. Cycle running containers

```bash
docker ps --filter name=nanoclaw-v2 --format '{{.Names}}' | xargs -r docker stop
```

Next agent message spawns a fresh container with the new mount + env.

## Verify

In the wired agent's chat: *"Leg ein Test-Doc im <target folder> an mit Titel 'X' und schreib 'Y' rein."* Expected: bot creates the doc and returns its URL.

If the MCP server reports "No saved token found. Starting interactive authentication flow…" check that:
- `HOME` env in `container.json` matches the mount parent
- `containerPath` resolves to `<HOME>/.config/google-docs-mcp/`
- The mounted `token.json` is readable inside the container (`docker exec <name> cat /workspace/extra/.config/google-docs-mcp/token.json`)

## Files touched

| File | Change |
|------|--------|
| `container/Dockerfile` | `ARG GOOGLE_DOCS_MCP_VERSION=<pinned>` + `RUN pnpm install -g "@a-bonus/google-docs-mcp@${GOOGLE_DOCS_MCP_VERSION}"` |

Per-install (not in repo): OneCLI app connections, mount-allowlist entry, per-group `container.json` `mcpServers`/`additionalMounts`, stub `token.json` on host.

## Update strategy

Bump `GOOGLE_DOCS_MCP_VERSION` deliberately — check the changelog at https://www.npmjs.com/package/@a-bonus/google-docs-mcp first. Verify the credential file shape hasn't changed at https://onecli.sh/docs/guides/credential-stubs/google-drive.md (or the general-app fallback).
