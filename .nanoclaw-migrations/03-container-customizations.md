# 03 — Container customizations

This section lists every container/agent-runner change that must be reapplied in v2.

---

## C8. Coolify labels + git-SHA tagging in build pipeline

**Files:** `container/Dockerfile`, `container/build.sh`

**Intent:** Coolify (auf Hetzner) hat einen nightly DockerCleanupJob, der ungenutzte Images löscht. Mit `coolify.managed=true` Label ist das Image vom Cleanup ausgenommen. Zusätzlich wird das Image mit dem Git-SHA getaggt für Traceability.

**Implementation:**

1. In `container/Dockerfile` (top of file, nach FROM):
```dockerfile
LABEL coolify.managed=true
```

2. In `container/build.sh`:
```bash
#!/bin/bash
set -e

cd "$(dirname "$0")"

GIT_SHA=$(git rev-parse --short HEAD)
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

docker build \
  --label "coolify.managed=true" \
  --label "org.opencontainers.image.revision=${GIT_SHA}" \
  --label "org.opencontainers.image.created=${BUILD_DATE}" \
  -t nanoclaw-agent:latest \
  -t nanoclaw-agent:${GIT_SHA} \
  -f Dockerfile .

# Verify image exists
docker image inspect nanoclaw-agent:latest >/dev/null

# Print size
SIZE=$(docker image inspect nanoclaw-agent:latest --format='{{.Size}}')
SIZE_MB=$((SIZE / 1024 / 1024))
echo "Image built: nanoclaw-agent:${GIT_SHA} (${SIZE_MB} MB)"
```

3. **Verify v2 build.sh:** v2's `container/build.sh` ist ein einfacher Wrapper. Unsere Änderungen oben drauf patchen — keine Konflikte erwartet.

---

## C9. Image vision support in agent-runner

**Files:** `container/agent-runner/src/index.ts`

**Intent:** Agent-Runner empfängt `imageAttachments: Array<{ relativePath: string; mediaType: string }>` als Teil von ContainerInput, lädt die Files aus `/workspace/group/<relativePath>`, baut `ImageContentBlock`s und schickt sie als initialer multimodaler User-Message an die SDK.

**Why v2 doesn't have this in our shape:** v2 nutzt `additionalDirectories` für File-Discovery durch die SDK selbst. Aber Telegram-Image-Empfang gibt uns _eine spezifische_ Image — die soll **direkt** in den ersten User-Turn als `ImageContentBlock`, nicht implizit via Directory-Scan.

**Implementation:**

1. In `container/agent-runner/src/index.ts` `ContainerInput`-Interface erweitern:
```typescript
interface ContainerInput {
  // ... bestehende v2 Felder ...
  imageAttachments?: Array<{ relativePath: string; mediaType: string }>;
}
```

2. ImageContentBlock-Typ definieren (SDK-kompatibel):
```typescript
interface ImageContentBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
  };
}
interface TextContentBlock {
  type: 'text';
  text: string;
}
type ContentBlock = ImageContentBlock | TextContentBlock;
```

3. Im Query-Setup (vor `for await (const message of query(...))`): falls `imageAttachments` da, baue Content-Blocks und pushe sie in den initialen User-Turn:
```typescript
if (containerInput.imageAttachments?.length) {
  const blocks: ContentBlock[] = [];
  for (const img of containerInput.imageAttachments) {
    const imgPath = path.join('/workspace/group', img.relativePath);
    try {
      const data = fs.readFileSync(imgPath).toString('base64');
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mediaType as ImageContentBlock['source']['media_type'],
          data,
        },
      });
    } catch (err) {
      log(`Failed to load image: ${imgPath}`);
    }
  }
  if (blocks.length > 0) {
    blocks.push({ type: 'text', text: prompt });
    // pushMultimodal: queue user message with content array instead of plain string
    stream.pushMultimodal(blocks);
  }
}
```

**Note:** v2's MessageStream-API muss `pushMultimodal(content: ContentBlock[])` anbieten oder erweitert werden. In v2 Worktree konkret prüfen.

---

## C10. /compact slash command interception in agent-runner

**Files:** `container/agent-runner/src/index.ts`

**Intent:** Wenn der prompt exakt `/compact` ist, nicht den normalen Agent-Loop laufen lassen, sondern einen separaten `query()`-Call mit `allowedTools: []`, `permissionMode: 'bypassPermissions'`, und auf das `compact_boundary`-System-Message warten. Damit triggert man SDK-natives Compaction und bekommt das Boundary-Event als Bestätigung.

**Why v2 doesn't have this:** v2 hat `/compact` nur im Host-Router als ADMIN_COMMAND, aber kein dedizierter Container-Pfad.

**Implementation in `container/agent-runner/src/index.ts`:**

```typescript
const KNOWN_SESSION_COMMANDS = new Set(['/compact']);
const trimmedPrompt = prompt.trim();
const isSessionSlashCommand = KNOWN_SESSION_COMMANDS.has(trimmedPrompt);

if (isSessionSlashCommand) {
  log(`Handling session command: ${trimmedPrompt}`);
  let compactBoundarySeen = false;
  let hadError = false;

  try {
    for await (const message of query({
      prompt: trimmedPrompt,
      options: {
        cwd: '/workspace/group',
        resume: sessionId,
        systemPrompt: undefined,
        allowedTools: [],
        env: sdkEnv,
        permissionMode: 'bypassPermissions' as const,
        allowDangerouslySkipPermissions: true,
        settingSources: ['project', 'user'] as const,
        hooks: {
          PreCompact: [{ hooks: [createPreCompactHook(containerInput.assistantName)] }],
        },
      },
    })) {
      if (
        message.type === 'system' &&
        (message as { subtype?: string }).subtype === 'compact_boundary'
      ) {
        compactBoundarySeen = true;
        log('Compact boundary observed — compaction completed');
      }
      // Emit results as they arrive (use v2's standard output protocol)
    }
  } catch (err) {
    hadError = true;
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Slash command error: ${errorMsg}`);
    writeOutput({ status: 'error', result: null, error: errorMsg });
  }

  if (!hadError && !compactBoundarySeen) {
    log('WARNING: compact_boundary was not observed.');
  }

  return;
}
```

**Note:** `createPreCompactHook` ist in v2 schon in `providers/claude.ts` definiert — importieren statt selbst neu schreiben.

---

## C11. Google Service Account mount + entrypoint base64 decode

**Files:** `container/Dockerfile` (entrypoint section), `src/container-runner.ts` (host-side mount logic)

**Intent:** Google Docs MCP-Server braucht eine SA-Key-JSON-Datei. Wir halten die Datei in `~/credentials/google-service-account.json` auf dem Host, mounten sie read-only in den Container als `/workspace/.google-sa.json` und setzen `SERVICE_ACCOUNT_PATH=/workspace/.google-sa.json`. Der Google-Docs-MCP-Server (pre-installed im Image, siehe C12) liest diese env var.

**Implementation:**

1. **Host-Side** in v2's `src/container-runner.ts` (oder dem Modul, das Mounts baut), additional mount logic einsetzen:
```typescript
// Mount Google Service Account key if available
const saKeyPath = path.join(
  process.env.HOME || '/home/nanoclaw',
  'credentials',
  'google-service-account.json',
);
if (fs.existsSync(saKeyPath)) {
  const containerSaPath = '/workspace/.google-sa.json';
  args.push(...readonlyMountArgs(saKeyPath, containerSaPath));
  args.push('-e', `SERVICE_ACCOUNT_PATH=${containerSaPath}`);
}
```

(`readonlyMountArgs` ist v2-internal helper für read-only `-v src:dst:ro`.)

2. **Server-Side credential file:** muss auf Hetzner unter `/home/<user>/credentials/google-service-account.json` liegen, mode 0600.

---

## C12. GitHub App token generation + mount

**Files:** `container/github-app-token.mjs` (new file), Dockerfile entrypoint, `src/container-runner.ts`

**Intent:** GitHub MCP-Server (pre-installed) braucht `GITHUB_PERSONAL_ACCESS_TOKEN`. Statt einen langlebigen PAT zu nutzen, generieren wir aus einem GitHub-App + Installation-ID + Private-Key bei jedem Container-Start einen 10-Minuten-Token via JWT-Exchange.

**Implementation:**

1. Copy `container/github-app-token.mjs` verbatim (49 lines):
```javascript
/**
 * Generate a GitHub App installation access token.
 *
 * Reads from environment variables:
 *   GITHUB_APP_ID              — GitHub App ID
 *   GITHUB_APP_INSTALLATION_ID — Installation ID
 *   GITHUB_APP_PRIVATE_KEY     — PEM private key (base64-encoded)
 *
 * Outputs the token to stdout (consumed by entrypoint.sh).
 */

import crypto from 'crypto';

const appId = process.env.GITHUB_APP_ID;
const installationId = process.env.GITHUB_APP_INSTALLATION_ID;
const privateKeyB64 = process.env.GITHUB_APP_PRIVATE_KEY;

if (!appId || !installationId || !privateKeyB64) {
  process.exit(1);
}

const privateKey = Buffer.from(privateKeyB64, 'base64').toString('utf8');

// Create JWT (RS256)
const now = Math.floor(Date.now() / 1000);
const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString('base64url');
const signature = crypto.sign('sha256', Buffer.from(header + '.' + payload), privateKey).toString('base64url');
const jwt = header + '.' + payload + '.' + signature;

// Exchange JWT for installation access token
const res = await fetch(
  `https://api.github.com/app/installations/${installationId}/access_tokens`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
    },
  },
);

const data = await res.json();
if (data.token) {
  process.stdout.write(data.token);
} else {
  process.exit(1);
}
```

2. **Dockerfile** — Datei ins Image kopieren, in der Entrypoint-Logik aufrufen:
```dockerfile
COPY github-app-token.mjs /app/github-app-token.mjs
```
Im entrypoint shell snippet (nach den ersten Credential-Source-Steps):
```bash
# Generate GitHub App installation token if credentials are available
if [ -n "${GITHUB_APP_PRIVATE_KEY:-}" ] && [ -n "${GITHUB_APP_ID:-}" ] && [ -n "${GITHUB_APP_INSTALLATION_ID:-}" ]; then
  GITHUB_TOKEN=$(node /app/github-app-token.mjs 2>/dev/null)
  if [ -n "$GITHUB_TOKEN" ]; then
    export GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"
  fi
fi
```

3. **Host-side** in `src/container-runner.ts`, GitHub-App-Key als base64-env-var an Container durchreichen:
```typescript
const ghKeyPath = path.join(
  process.env.HOME || '/home/nanoclaw',
  'credentials',
  'github-app.pem',
);
if (fs.existsSync(ghKeyPath)) {
  const ghKeyB64 = fs.readFileSync(ghKeyPath).toString('base64');
  args.push('-e', `GITHUB_APP_PRIVATE_KEY=${ghKeyB64}`);
  args.push('-e', `GITHUB_APP_ID=${process.env.GITHUB_APP_ID || ''}`);
  args.push('-e', `GITHUB_APP_INSTALLATION_ID=${process.env.GITHUB_APP_INSTALLATION_ID || ''}`);
}
```

4. **Env vars (`.env`):**
   - `GITHUB_APP_ID`
   - `GITHUB_APP_INSTALLATION_ID`
   - **Plus** PEM-File auf Server in `~/credentials/github-app.pem`

---

## C13. Pre-installed MCP servers — keep extras (google-docs-mcp, github-mcp-server)

**Files:** `container/Dockerfile`

**v2 status:** v2-Dockerfile installs `agent-browser`, `@anthropic-ai/claude-code`, `vercel`. Ohne Google Docs und ohne GitHub.

**Implementation:** In v2's Dockerfile zusätzlich:
```dockerfile
# Google Docs MCP server (npm)
RUN pnpm install -g @a-bonus/google-docs-mcp

# GitHub MCP server (Go binary from official releases)
RUN curl -fsSL https://github.com/github/github-mcp-server/releases/latest/download/github-mcp-server_Linux_x86_64.tar.gz \
    | tar -xz -C /usr/local/bin github-mcp-server
```

**Wiring in agent-runner** (`container/agent-runner/src/index.ts` mcpServers config):
```typescript
mcpServers: {
  // ... v2 stock servers ...
  ...(process.env.SERVICE_ACCOUNT_PATH ? {
    'google-docs': {
      command: 'google-docs-mcp',
      args: [],
      env: { SERVICE_ACCOUNT_PATH: process.env.SERVICE_ACCOUNT_PATH || '' },
    },
  } : {}),
  ...(process.env.GITHUB_PERSONAL_ACCESS_TOKEN ? {
    'github': {
      command: 'github-mcp-server',
      args: ['stdio'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
        GITHUB_TOOLSETS: 'repos,issues,context',
      },
    },
  } : {}),
},
```

`allowedTools` mit `'mcp__google-docs__*'` und `'mcp__github__*'` ergänzen.

---

## C14. ImageMagick package in container

**Files:** `container/Dockerfile`

**Intent:** Agents brauchen `magick` CLI für Image-Cropping/Conversion (z.B. für `/generate-image`-Skill: nach FLUX-Generation auf Instagram-Format zuschneiden).

**Implementation:** In v2's Dockerfile (apt-get install Block) `imagemagick` ergänzen:
```dockerfile
RUN apt-get update && apt-get install -y \
    # ... v2 packages ...
    imagemagick \
    && rm -rf /var/lib/apt/lists/*
```

---

## C15. Drop list (container files NOT migrated)

| File | Grund |
|---|---|
| `container/agent-runner/src/ipc-mcp-stdio.ts` | v2 hat `mcp-tools/core.ts` + `mcp-tools/scheduling.ts` mit denselben Tools (sogar mehr: Reactions, Edit-Message). Drop. |
| `container/agent-runner/src/ollama-mcp-stdio.ts` | User nutzt Ollama nicht. Drop. |
| `container/Dockerfile` USER node line, mount --bind /dev/null logic, /workspace/extra discovery | v2 löst das eigenständig. Drop. |
| Apple-Container-Conditionals in entrypoint | Linux-only. Drop. |
| `container/agent-runner/src/index.ts` Custom-Anteile, die v2 hat: PreCompactHook, telemetry-opt-out env, /workspace/global loading, task-script wakeAgent flag, additionalDirectories scan | Drop, v2 hat alles. |

## Verification after reapply

- `cd container/agent-runner && npm run build` erfolgreich
- `bash container/build.sh` baut Image, Coolify-Label vorhanden: `docker image inspect nanoclaw-agent:latest --format='{{.Config.Labels}}'` enthält `coolify.managed:true`
- `docker run --rm nanoclaw-agent:latest bash -c 'which magick && which github-mcp-server && which google-docs-mcp'` — alle drei vorhanden
