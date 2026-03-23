# Secrets Management — Research & Entscheidung

**Datum:** 2026-03-23
**Kontext:** Vorbereitung Server-Deployment auf Hetzner CX23

## Fragestellung

Wie schützen wir API-Credentials (Teable, Replicate, Cloudflare Access) wenn NanoClaw auf einem shared Server läuft?

## Ist-Zustand (Probleme)

1. **Passthrough-Credentials als Klartext-Env-Vars** — `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, `TEABLE_ACCESS_TOKEN`, `REPLICATE_API_TOKEN` werden via `docker run -e` an Container durchgereicht. Jeder Prozess der Docker inspizieren kann, sieht diese Werte.
2. **Credential Proxy bindet auf `0.0.0.0`** — Fallback auf Bare Linux exponiert den Proxy im gesamten Netzwerk.
3. **Keine Docker-Netzwerk-Isolation** — Container laufen im Default-Bridge-Netzwerk, können theoretisch andere Services (Teable, Coolify) erreichen.
4. **`.env` als Klartext auf dem Host** — Kein Schutz at-rest.

## Evaluierte Optionen

### dotenvx

**Was es ist:** Verschlüsselt `.env`-Dateien mit AES-256-GCM + secp256k1, sodass sie sicher ins Git können. Entschlüsselung zur Laufzeit via `DOTENV_PRIVATE_KEY`.

**Kryptographie:** Solide (AES-256-GCM, secp256k1 — gleiche Kurve wie Bitcoin).

**Adoption:** 5.2k GitHub Stars, 464k wöchentliche npm-Downloads. Genutzt von PayPal, NASA, Supabase.

**Kritik aus der Security-Community:**

- **Trend Micro, OWASP, CyberArk, Arcjet** warnen: Environment Variables sind **architektonisch falsch** für Secrets — egal ob verschlüsselt oder nicht
- Secrets landen in Crash-Dumps, Logs, Error-Trackern, Child-Prozessen
- dotenvx verschiebt das Problem: statt `.env` muss man `.env.keys` schützen
- **Kein unabhängiges Security-Audit** veröffentlicht
- **21 npm Dependencies** vs. dotenv mit null — größere Supply-Chain-Angriffsfläche
- Bei RCE-Angriff sind entschlüsselte Env-Vars sofort exponiert

**Fazit:** Verbesserung gegenüber Klartext-`.env` im Git, aber kein fundamentaler Sicherheitsgewinn. Löst nicht das Container-Passthrough-Problem.

### HashiCorp Vault / AWS Secrets Manager

**Was es ist:** Zentralisierter Secret Store mit dynamischen Secrets, Audit-Logs, automatischer Rotation.

**Fazit:** Overkill für 2-Personen-Team mit einem Server. Hohe Betriebskomplexität.

### SOPS (Mozilla)

**Was es ist:** Verschlüsselung mit Cloud-KMS-Integration (AWS, GCP, Azure).

**Fazit:** Braucht Cloud-Provider KMS. Für unseren Use-Case (einzelner Hetzner-Server) keine gute Passung.

### Docker Secrets

**Was es ist:** OS-level verschlüsselte Secrets, read-only in Container gemountet.

**Fazit:** Nur mit Docker Swarm verfügbar. Wir nutzen Standalone Docker.

### Credential Proxy erweitern (unser Ansatz)

**Was es ist:** Den bestehenden Anthropic-Credential-Proxy auf alle externen APIs ausweiten. Container machen API-Calls über den Proxy, der die echten Credentials injiziert.

**Vorteile:**
- Baut auf bestehendem, funktionierendem Muster auf
- Container sehen nie echte Tokens
- Keine neuen Tools, keine externen Services
- Kein zusätzliches Key-Management
- Aligns mit NanoClaw's eigenem Security-Modell

**Nachteile:**
- Hostname-Mappings hardcoded (akzeptabel für kleine Teams)
- `.env` auf dem Host bleibt Klartext (durch Server-Absicherung mitigiert)

## Entscheidung

**Credential Proxy erweitern** — alle API-Credentials über den Proxy routen statt als Env-Vars durchzureichen.

Ergänzend:
- `.env` nie ins Git committen (bleibt in `.gitignore`)
- Server-Zugang absichern (SSH keys, Firewall — bereits vorhanden)
- Credential Proxy auf `127.0.0.1` locken
- Isoliertes Docker-Netzwerk für NanoClaw-Container

dotenvx wird **nicht** eingesetzt — der Nutzen rechtfertigt die zusätzliche Komplexität und Dependencies nicht.

## Quellen

- [Trend Micro: Hidden Danger of Environment Variables](https://www.trendmicro.com/en_us/research/22/h/analyzing-hidden-danger-of-environment-variables-for-keeping-secrets.html)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [CyberArk: Environment Variables Don't Keep Secrets](https://developer.cyberark.com/blog/environment-variables-dont-keep-secrets-best-practices-for-plugging-application-credential-leaks)
- [Arcjet: Storing Secrets in Env Vars Considered Harmful](https://blog.arcjet.com/storing-secrets-in-env-vars-considered-harmful/)
- [NanoClaw Security Model](https://nanoclaw.dev/blog/nanoclaw-security-model/)
- [Anthropic: Claude Code Sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing)
- [Hacker News: dotenvx Discussion](https://news.ycombinator.com/item?id=40789353)
- [dotenvx Documentation](https://dotenvx.com/)
