# Security Guide — Accelera v2.1

Last audited: **2026-04-09**

This document describes the security posture of the Accelera codebase, what controls are in place, known limitations, and hardening recommendations.

---

## Audit Summary

| Area | Status | Notes |
|---|---|---|
| SQL injection | **Pass** | All queries use parameterized bindings (`?`) |
| XSS | **Pass** | React auto-escapes output; no raw HTML injection |
| SSRF | **Pass** | URL validation on `/api/hosts` and `/api/ollama/discover` |
| Secret management | **Pass** | Auto-generated Flask secret key; secrets masked in API |
| CORS | **Warning** | Defaults to `*` — restrict for production |
| Shell commands | **Acceptable** | `run_cmd` uses `shell=True` with hardcoded commands only |
| Rate limiting | **Missing** | No built-in rate limiting; use reverse proxy |
| ollama-metrics proxy | **Pass** | Transparent proxy; no auth bypass; response-only parsing |

---

## Controls Implemented

### 1. Input Validation
- **Host URLs** — Validated via `is_valid_host_url()` before storage. Must be `http` or `https` with a valid hostname and port range.
- **Ollama discovery** — `/api/ollama/discover` validates `hostUrl` before making outbound requests.
- **Query parameters** — Numeric params like `hours` are clamped to safe ranges (e.g., 1–168 for token stats).
- **Alert rules** — Required fields enforced; IDs generated server-side.

### 2. Secret Management
- **Flask secret key** — Auto-generates a 256-bit random key via `secrets.token_hex(32)` if `FLASK_SECRET_KEY` is not set in the environment. No hardcoded fallback.
- **Secret masking** — `FLASK_SECRET_KEY` and `ALERT_EMAIL_PASSWORD` are masked with `••••••••` in the settings API response (`_SECRET_KEYS` in `config.py`).
- **`.env` gitignored** — `.env`, `.env.local`, and all `.env.*.local` variants are excluded from version control.

### 3. SQL Security
- **Parameterized queries** — Every `db.execute()` call in `storage.py` uses `?` placeholders. No string interpolation in SQL.
- **WAL mode** — SQLite uses Write-Ahead Logging for safe concurrent access.
- **Busy timeout** — 5-second timeout prevents lock contention crashes.

### 4. Frontend Security
- **No `dangerouslySetInnerHTML`** in application code (only in vendored shadcn chart component).
- **No eval/Function** calls in frontend code.
- **LocalStorage only** — Stores host URLs, UI preferences, and a bcrypt-hashed dashboard password. No plain-text secrets.

### 5. Docker Security
- GPU exporter runs privileged (required for NVML/nvidia-smi access) with `pid: host` for process detection. This is by design and documented.
- Frontend container runs unprivileged Node.js process.
- No secrets baked into images.

### 6. ollama-metrics Sidecar Proxy
- Runs as a transparent proxy between clients and Ollama — no authentication bypass, no request modification (except injecting `stream_options.include_usage` for metrics collection).
- Only parses response bodies to extract token counts; does not store, log, or forward prompt/response content.
- The injected `stream_options.include_usage=true` is a read-only Ollama feature flag — it adds a usage summary to the SSE stream but does not alter model behavior or output.
- No secrets, API keys, or credentials are handled by the proxy.
- Container runs unprivileged from `scratch` (no shell, no OS packages, minimal attack surface).

---

## Known Limitations

### CORS Defaults to `*`
The default `CORS_ORIGINS=*` allows any origin. For production deployments, set this to your specific frontend domain(s):
```bash
CORS_ORIGINS=https://dashboard.example.com
```

### No Built-in Rate Limiting
API endpoints have no rate limiting. Deploy behind a reverse proxy (nginx, Caddy, Traefik) and configure rate limits there:
```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
location /api/ {
    limit_req zone=api burst=50 nodelay;
    proxy_pass http://localhost:5000;
}
```

### Shell Command Execution
`server/utils.py:run_cmd()` uses `subprocess.check_output(..., shell=True)`. All callers pass hardcoded nvidia-smi / system commands — no user input reaches these calls. The function docstring documents this requirement.

### GPU Exporter Privileges
The GPU exporter container requires `privileged: true` and `pid: host` to access NVML and detect host processes. This is an inherent requirement of nvidia-smi monitoring and cannot be reduced without losing functionality.

---

## Production Hardening

### Environment Variables
```bash
# Generate a strong secret key
FLASK_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")

# Restrict CORS
CORS_ORIGINS=https://your-domain.com

# Disable debug
FLASK_DEBUG=false

# Bind to localhost if behind reverse proxy
FLASK_HOST=127.0.0.1
```

### Reverse Proxy (Recommended)
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Firewall
```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 443/tcp   # HTTPS
sudo ufw deny 5000/tcp   # Block direct backend access
sudo ufw deny 8080/tcp   # Block direct frontend access
sudo ufw enable
```

---

## Reporting Vulnerabilities

If you discover a security vulnerability, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email the maintainers with a description and steps to reproduce
3. Allow reasonable time for a fix before public disclosure

---

## Dependency Auditing

```bash
# Frontend
npm audit

# Backend
pip-audit

# Docker images
docker scout cves accelera-frontend
```

---

*Security is an ongoing process. This document is updated with each audit.*