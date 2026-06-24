# OneCLI — credential model, capabilities, and limits

Canonical reference for how OneCLI works in this project. Read this **before**
designing any feature that needs a credential — especially before exploring
"how does the container get secret X". The recurring answer for non-HTTP
protocols is at the bottom.

OneCLI runs **on the server**, not on dev workstations. The gateway listens at
`http://127.0.0.1:10254`. The host (Node) holds `ONECLI_API_KEY`; containers do
**not**.

## The one-sentence model

OneCLI is a **transparent HTTPS forward-proxy with a per-request credential
injector**. It MITMs outbound TLS (via a CA cert it plants in the container),
matches each request by **host + path**, and substitutes the real credential as
the request leaves the container. Nothing else.

Consequence: OneCLI only ever sees, and only ever injects into, **outbound
HTTP(S)**. It is blind to every other protocol.

## What gets wired into a container

`applyContainerConfig()` (host-side, at spawn) adds exactly two things to the
container, via `getContainerConfig()` → `{ env, caCertificate,
caCertificateContainerPath }`:

1. **Proxy env vars** — `HTTPS_PROXY` / `HTTP_PROXY` pointing at the gateway.
   Standard HTTP clients (curl, fetch, axios, git, Go net/http) honor these
   automatically. `env` here is **proxy config, not secrets**.
2. **A CA certificate** — so the MITM proxy can terminate/re-originate TLS
   without the client screaming about a bad cert.

That's the whole injection surface. See `src/container-runner.ts` (`onecli.ensureAgent`
→ `onecli.applyContainerConfig`).

## What the container can do

Just call the real API URL. The gateway injects the credential if the agent is
connected to that app/secret:

```bash
curl -s "https://api.airtable.com/v0/<base>/<table>"
curl -s "https://gmail.googleapis.com/gmail/v1/users/me/messages"
```

No auth headers, no tokens in the container. On 401/403/`app_not_connected` the
gateway returns a `connect_url`. Container-side guidance lives in the
`onecli-gateway` container skill (`container/skills/onecli-gateway/SKILL.md`).

## Host-side SDK surface (`@onecli-sh/sdk`, pinned 0.5.0)

The **entire** API the host has. There is deliberately **no secret-fetch / reveal
method** anywhere:

| Method | Purpose |
|--------|---------|
| `getContainerConfig(agent?)` | Returns `{ env, caCertificate, caCertificateContainerPath }` (proxy config + CA cert — **not** secret values). |
| `applyContainerConfig(args, opts)` | Mutates Docker args to add the proxy env + CA cert mount. `opts.addHostMapping` adds a host mapping. |
| `ensureAgent` / `createAgent` | Create/ensure the per-agent-group vault identity. |
| `provisionUser` | Provision a vault user (returns a `claimUrl` + apiKey). |
| `configureManualApproval(cb)` | Long-polls `GET /api/approvals/pending`; routes credentialed-action approvals to a human. See `src/modules/approvals/onecli-approvals.ts`. |

There is no `getSecret`, no `revealSecret`, no `secrets.*` on the SDK. Host code
cannot pull a plaintext credential out of OneCLI.

## CLI — vault management only (no value retrieval)

The `onecli` CLI (server) manages the vault. It assigns and lists; it does **not**
hand back plaintext values:

```bash
onecli agents list                                     # agent ids (identifier = agent group id)
onecli agents set-secret-mode --id <id> --mode all     # inject every host-pattern-matching secret
onecli agents set-secrets --id <id> --secret-ids a,b   # selective assignment
onecli agents secrets --id <id>                         # which secrets an agent has
onecli secrets list                                     # secret ids + host patterns (NOT values)
onecli secrets create ...                               # register a new secret
```

`secrets list` shows ids and host patterns, never plaintext. There is no
documented `secrets get`/`reveal`. The security guarantee (docs/SECURITY.md §5,
docs/v1-to-v2-changes.md) is explicit: *"Agents cannot discover real credentials
— not in environment, stdin, files, or /proc"* and *"the container never sees
the raw secret value."* That guarantee is the whole product; treat any urge to
extract a raw value as fighting the design.

Gotcha — auto-created agents start in `selective` mode (no secrets attached). Fix
with `set-secret-mode --mode all`. See the root **CLAUDE.md** "auto-created agents
start in selective secret mode" section for the full writeup.

## Admin web UI

App connections (Google Apps Framework OAuth, approval rules the CLI can't set)
are configured at the web UI. Reach it from a workstation via SSH tunnel:

```bash
ssh -L 10254:127.0.0.1:10254 <host>   # then open http://localhost:10254
```

(This tunnel is **admin access to the UI** — it is *not* a runtime credential
path for the container. See docs/FORK-MAINTENANCE.md.)

## ⚠️ The recurring question: non-HTTP protocols (IMAP, SMTP, SSH, raw TCP)

**OneCLI cannot supply credentials to anything that isn't HTTP(S).**

- The proxy never sees IMAP/993, SMTP/465, SSH, or any raw-TCP traffic, so it
  cannot inject.
- The SDK/CLI expose no API to fetch a raw secret value, so you cannot pull the
  password out and hand it to an IMAP client yourself either.

Both halves of OneCLI (proxy injection **and** any fetch path) structurally do
not apply. This is by design, not a missing feature.

**Therefore:** a credential for a non-HTTP protocol must live **outside OneCLI**,
in the host trusted zone (host `.env` — which is shadowed with `/dev/null` in the
container mount, see docs/SECURITY.md — or a `0600` host file / systemd
`LoadCredential`), and the non-HTTP I/O must run **on the host**, never in the
container. Surface only the *results* to the agent (e.g. via the inbound session
DB), and let the agent do its downstream work over HTTP APIs (Airtable, etc.)
through the normal OneCLI proxy.

Concrete instance: the IMAP mail-reading feature (Issue lunoapp/lunobot#1) — the
IMAP password cannot be sourced from OneCLI; the IMAP read is therefore a
host-side concern. See that issue for the chosen design.

### "But the Gmail integration works through OneCLI?"

Yes — because **Gmail has an HTTP API**. `nanoclaw-gmail` / `/add-gmail-tool`
call `gmail.googleapis.com` over HTTPS, so the proxy injects the OAuth token
normally. That is the HTTP path, not IMAP.

Rule of thumb: **if the provider offers an HTTP API, use it and let OneCLI inject
(Gmail, Airtable, etc.). If the only access is IMAP/SMTP (Hetzner mailboxes),
OneCLI cannot help — read host-side with `imapflow` and creds in `.env`.** This is
the established ecosystem pattern (see nanocoai/nanoclaw#813: host-side `imapflow`
poll, `.env` creds, scheduled, shipped as a skill — explicitly not via OneCLI).
