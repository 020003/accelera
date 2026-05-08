# Changelog

## [2.2.0] — 2026-05-08

### Added
- **Central backend service** (`server/central/`) — dedicated Flask + Gunicorn app for server-side authentication (bcrypt + session cookies), first-run setup flow, host CRUD, and a settings key-value store, all persisted to SQLite on a Docker volume. Replaces the previous client-side localStorage auth model
- **Nginx `/api/` envsubst template** — proxies all auth, host, and settings calls to the central backend; `depends_on: service_healthy` ensures the frontend only starts after the backend is ready
- **First-run setup UI** — login page now supports both setup (creating the initial admin account) and sign-in flows; protected routes show a loading spinner during session checks
- **`bucket_sec` field in `/api/tokens/stats`** — frontend can introspect the adaptive bucket size used for the chart x-axis

### Changed
- **Frontend host management** — `useAuth`, `Dashboard`, `HostManager`, `SettingsTab`, and `AdvancedVisualizations` all migrated to fetch hosts/settings from the central backend with `credentials: 'include'`
- **GPU exporter rate limit** — increased from 60 → 600 req/60s to accommodate the new central-polling pattern
- **Token-stats time series** — buckets are now adaptive (60s → 2h, ~90 buckets per window) and zero-filled across the full window so the chart x-axis is continuous and consistent across time-window changes
- **`current_tps`** — now a rolling 5-minute average with counter-reset handling, instead of being computed from just the last two snapshots (which read 0 most of the time)
- **`avg_tokens_per_sec` per model** — uses the windowed `time_per_token` delta (Δsum / Δcount) when the backend exposes it, falling back to `generated_tokens / request_duration` so it reflects the selected window rather than an all-time average
- **vLLM throughput metric** — switched from `time_to_first_token_seconds` (per-request) to `inter_token_latency_seconds` (per-token); fixes a 50× under-reporting on the dashboard (was ~2 tok/s, actual ~100 tok/s)

### Fixed
- **Dashboard auto-refresh infinite request loop** — the polling effect depended on `hosts`, whose `isConnected` flag was rewritten on every fetch, re-triggering the effect immediately and hammering GPU exporters into rate-limit territory until the dashboard went blank. Effect now keys on a stable URL-only `hostsKey`
- **SGLang false positive on hosts running vLLM** — `_probe_sglang` accepted any HTTP 200 on `/v1/models`, but vLLM exposes the identical OpenAI-compatible endpoint on port 8000. Probe now requires a successful response from the SGLang-specific `/get_server_info` first
- **Topology hook stuck on obsolete env var** — `useTopology` was reading host URLs from `VITE_BACKEND_HOSTS` (no longer set post-refactor) and falling back to `window.location:5000` (the frontend host, with no GPU exporter). Now loads hosts from the central backend like the rest of the dashboard
- **Token-stats summary undercount on counter resets** — `MAX − MIN` over a window where Ollama/vLLM restarted gave wrong totals; added a pairwise-diff cross-check that takes the larger of the two estimates

### Security
- **`flask-cors` removed entirely** — central backend is only reachable via the nginx same-origin proxy, so the previous wildcard-CORS-with-credentials configuration (which would have let any origin make authenticated API calls) is gone
- **Rate limiting on central backend** — 120 req/60s per IP via in-process middleware
- **Login lockout** — 5 failed attempts trigger a 30s lockout with exponential backoff (doubling up to 15 min); correct credentials are still rejected while locked
- **Single-worker Gunicorn** (1 worker × 4 threads) — ensures the in-memory lockout and rate-limit dicts are shared across all requests
- **SSRF default-deny on nginx proxy** — all RFC1918 ranges (10/8, 172.16/12, 192.168/16) are blocked unless explicitly whitelisted via `ALLOWED_PROXY_RANGE`
- **Secret hygiene** — `.secret_key` is written with 0600 permissions and added to `.gitignore`; `SESSION_COOKIE_SECURE` is now configurable; the 400 handler no longer leaks exception details

---

## [2.1.1] — 2026-04-09

### Fixed
- **Ollama `/v1/chat/completions` token tracking** — patched the `ollama-metrics` sidecar proxy to parse real `usage.prompt_tokens` and `usage.completion_tokens` from OpenAI-compatible endpoint responses (both streaming and non-streaming); previously only `/api/generate` and `/api/chat` tokens were counted
- **Streaming token injection** — proxy now injects `stream_options.include_usage=true` into streaming `/v1/` requests so Ollama returns token counts in the final SSE chunk, ensuring accurate metrics regardless of client configuration
- **Scientific notation in Prometheus metrics** — all regex patterns in `tokens.py` (Ollama, SGLang, vLLM) updated from `[\d.]+` to `[\d.eE+\-]+` to correctly parse large counter values reported in scientific notation (e.g. `1.636532e+06`)
- **Token timeline graphs empty after counter reset** — `storage.py` now handles Prometheus counter resets (e.g. after proxy restart) by treating the new value as the delta instead of clamping to zero
- **SQLite disk-full resilience** — `prune_old_history()` and `prune_old_token_snapshots()` now execute `PRAGMA wal_checkpoint(TRUNCATE)` after pruning to reclaim WAL disk space; database connections are recycled on error to prevent poisoned connection state
- **Dockerfile fix for `ollama-metrics`** — corrected `COPY` binary name mismatch and bumped Go build image to `golang:1.24-alpine` to match `go.mod` requirements

### Changed
- **`ollama-metrics` proxy** — upgraded from upstream `ghcr.io/norskhelsenett/ollama-metrics:latest` to a patched build with full OpenAI-compatible API support; deployed to all GPU hosts

### Security
- **No new attack surface** — the `ollama-metrics` proxy patch only adds response body parsing for existing proxied traffic; no new network listeners, no secrets, no user input in queries

---

## [2.1.0] — 2026-04-07

### Added
- **GPU Process Inspector** — new `Processes` tab per host with deep process analysis: PID, resolved name, command line, user, VRAM usage, uptime, CPU%, AI runtime detection (Ollama/SGLang/vLLM/Triton/PyTorch), and model name resolution via Ollama `/api/ps`, SGLang `/v1/models`, and vLLM `/v1/models`; auto-refreshes every 10 seconds
- **Enriched GPU card processes** — process list on GPU cards now shows resolved names, runtime badges, model names, and AI category indicators instead of bare PIDs
- **AI Model Benchmark Runner** — new `Benchmark` tab to test Ollama/SGLang/vLLM model throughput with preset prompts; measures tokens/sec, TTFT, generated tokens, total duration; results persisted in SQLite
- **Webhook notifications** — enhanced alert webhook delivery with auto-detection of Slack (Block Kit), Discord (embeds), and generic HTTP; new endpoints `GET/PUT /api/alerts/webhook`, `POST /api/alerts/webhook/test`
- **SGLang Runtime integration** — auto-discovery via `/api/sglang/discover`, UI badges, model counts, and per-host tags mirroring the existing Ollama pattern
- **SGLang token tracking** — backend scrapes SGLang usage statistics for TPS, latency, and request counts
- **Token-based alerts** — alert rules can now target `tps`, `total_tokens`, `request_count`, and `avg_latency` metrics (fleet-level)
- **Dark/light theme toggle** — `useTheme` hook with Sun/Moon toggle in Dashboard and Advanced Visualizations headers; state persisted in localStorage
- **CORS nginx proxy** — all frontend fetch calls route through `/api-proxy/` on nginx, eliminating cross-origin issues and keeping backend IPs out of the browser
- **Dynamic currency selection** — `useCurrency` hook with currency selector in Settings; all cost displays reflect the chosen currency
- **Production Docker build** — multi-stage `Dockerfile` (Node build → nginx), `nginx.conf` with SPA routing, gzip, asset caching, and `/health` endpoint; `.dockerignore` for faster builds
- **GPU exporter `/health` endpoint** — returns host info, GPU count, and uptime
- **vLLM integration** — auto-discovery via `/api/vllm/discover`, UI badges, model counts, and per-host tags mirroring the existing Ollama pattern
- **vLLM token tracking** — backend scrapes vLLM usage statistics for TPS, latency, and request counts
- **vLLM model benchmarking** — new `Benchmark` tab to test vLLM model throughput with preset prompts; measures tokens/sec, TTFT, generated tokens, total duration; results persisted in SQLite
- **Helm chart** — production-ready `helm/accelera/` chart for Kubernetes and OpenShift; GPU exporter as DaemonSet with `hostNetwork`/`hostPID`/`privileged`, frontend Deployment with auto-detected cluster DNS, Ingress (K8s) or Route + SCC (OpenShift), configurable via `values.yaml`

### Fixed
- **Advanced Visualizations light mode** — replaced hardcoded dark-only colors in `GPUTopologyMap`, `GPU3DHeatmap`, and global CSS with theme-aware values
- **Plotly 3D heatmap theme** — axis labels, tick fonts, grid colors, and scene background now adapt to light/dark mode via MutationObserver
- **ReactFlow light mode** — added CSS overrides for background, controls, and attribution in light theme
- **vis-timeline light mode** — added `.light` CSS overrides for axis text, grid lines, labels, and current-time indicator
- **SGLang data wiped on refresh** — smart-update merge now preserves `sglang` alongside `ollama` between refresh cycles
- **Cost per 1M tokens mismatch** — label and computation now use the correct time-range
- **Fleet/per-host Token charts empty** — replaced `slice()` truncation with full-range downsampling

### Changed
- **Advanced Visualizations redesign** — polished header with theme toggle, larger tabs, card-wrapped legends with uppercase tracking labels, improved loading/error states with animated indicators
- **Cost metric unit** — "Cost per 1K tokens" → "Cost per 1M tokens"
- **Frontend deployment** — production nginx with pre-built static assets via `docker-compose.frontend.yml`

### Security
- **SSRF protection on nginx proxy** — blocks requests to localhost, loopback, cloud metadata (169.254.x.x), link-local IPv6; restricts proxy to port 5000 only
- **Security headers** — added `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` to nginx
- **SHA-256 password hashing** — replaced weak 32-bit DJB2 hash with Web Crypto SHA-256; legacy hashes auto-upgrade on next login
- **Secret masking** — `FLASK_SECRET_KEY` and `ALERT_EMAIL_PASSWORD` are never exposed to the frontend API
- **Traceback leak fix** — topology API no longer returns Python tracebacks in error responses
- **Logging hygiene** — replaced bare `print()` calls in alerts.py with proper `logging` module

### Removed
- **AIWorkloadTimeline** — component, all references, and vis-timeline CSS removed
- **Legacy Index page** — `Index.tsx`, `/legacy` route, and associated hooks (`useGpuHistory`, `usePowerHistory`) and components (`GpuHistoryPanel`) deleted
- **Dead components** — `OverviewStats`, `ControlPanel`, `AppLayout`, `AppSidebar` removed
