# Security, Refactor, and Robustness Backlog

_Last reviewed: 2026-05-11 (post-v2.3 ship)_

This file enumerates the known limitations of the current codebase and a
prioritised list of refactors to address them.  Items use a stable ID
(`S-*` security, `R-*` refactor, `O-*` operability) so they can be
referenced from issues, commits, and the CHANGELOG.

Severity scale: **Critical** \u2192 **High** \u2192 **Medium** \u2192 **Low** \u2192 **Info**.

---

## Security

### S-1 \u2014 GPU exporter has no authentication  \u2014 **High**
**Where:** every endpoint in `server/blueprints/*.py`.

**Risk:** any process that can reach `:5000` on a GPU host can read
GPU metrics, the full process table (PIDs, command lines, users), and
trigger benchmark runs against locally-hosted models.  The exporter
trusts the network.

**Mitigation in place:**
- nginx `/api-proxy/` is the only path the browser can use; it has an
  SSRF allowlist (`ALLOWED_PROXY_RANGE`) and cookie scrubbing.
- Per-IP rate limit (600 req/60 s).

**Proposed fix:** add a shared-secret HMAC header (`X-Accelera-Token`)
that the central backend injects on every `/api-proxy/` request and
the exporter validates.  Rotated via the existing settings store.
Estimated effort: ~150 LOC across nginx, central backend, and a small
Flask `before_request` hook.

### S-2 \u2014 In-memory rate limit \u2192 broken on multi-worker  \u2014 **Medium**
**Where:** `server/central/middleware.py`.

The token bucket and login-lockout dicts live in process memory.
Today this is fine because the central backend ships as 1 worker \u00d7 4
threads, but the failure mode is silent \u2014 if someone bumps
`--workers` for performance, attackers can brute-force the login by
hopping between workers.

**Proposed fix:** lift the counters into the SQLite layer (already
WAL-mode and shared across threads/processes).  Two extra tables:
`rate_buckets(ip, window_start, count)` and
`login_failures(ip, count, locked_until, last_failure)`.  Cleanup is
already periodic so no extra cron.  ~80 LOC.

### S-3 \u2014 `SESSION_COOKIE_SECURE` defaults to `false`  \u2014 **Medium**
**Where:** `server/central/app.py`.

When the dashboard is exposed via TLS, this should be `true`.  Today
operators have to remember.

**Proposed fix:** auto-detect via `X-Forwarded-Proto: https` in a
`before_request` and toggle `app.config["SESSION_COOKIE_SECURE"]`
dynamically; or simpler: set it to `true` by default and document the
HTTP-only-LAN escape hatch.

### S-4 \u2014 No CSRF token on state-changing endpoints  \u2014 **Low**
**Where:** all `POST` / `PUT` / `PATCH` / `DELETE` central routes.

Mitigated today by:
- `SameSite=Lax` (blocks third-party top-level navigation POSTs)
- JSON `Content-Type` requirement (triggers CORS preflight, which is
  same-origin so it succeeds, but blocks `<form>` based CSRF entirely)

**Proposed fix:** add a `X-CSRF-Token` derived from the session, served
on `/api/auth/status`, validated in `before_request`.  Defense in
depth.  ~40 LOC.

### S-5 \u2014 `CORS_ORIGINS=*` default on GPU exporter  \u2014 **Low (with S-1 open)**
**Where:** `server/config.py`.

Since the exporter has no auth, CORS doesn't actually protect anything
that isn't already public over the LAN.  Still misleading: the README
implies CORS is a security boundary.

**Proposed fix:** drop `flask_cors` from the exporter entirely; the
exporter is only reached via nginx which already injects the right
headers on the proxy path.  ~10 LOC + dep removal.

### S-6 \u2014 `run_cmd(shell=True)` pattern  \u2014 **Info**
**Where:** `server/utils.py`, `server/blueprints/{gpu,topology,events}.py`.

Currently safe: every call site passes a hardcoded string.  Easy to
break in a future patch.  Rewriting as `subprocess.run([...], shell=False)`
makes the safety invariant impossible to violate.  ~30 LOC.

### S-7 \u2014 Password change doesn't invalidate other sessions  \u2014 **Info**
**Where:** `server/central/auth.py:change_password`.

If an attacker has captured a session cookie and the user notices and
changes their password, the attacker's session stays valid until
expiry.  Mitigation: rotate `app.secret_key` (kills all sessions
globally), or add a per-user session epoch in the DB.

---

## Refactor (correctness / clarity)

### R-1 \u2014 Unify `hosts` and `hostsData` state in `Dashboard.tsx`  \u2014 **High**
**Where:** `src/pages/Dashboard.tsx`.

Two parallel state slices for the same conceptual entity caused both
the recent power-chart bug (`isConnected` stuck at false on `hosts`)
and the topology stale-error bug.

**Proposed fix:** extract a single `useFleetHosts()` hook that owns the
URL list, names, ordering, polling, and per-host `isConnected` /
`gpus` / `ollama` / `sglang` / `vllm` state.  Consumers receive a
unified `FleetHost[]` shape.  Reduces `Dashboard.tsx` from 808 \u2192 ~400
lines and eliminates the entire class of "two states drift apart"
bugs.

### R-2 \u2014 Replace `setInterval` + manual closures with React Query  \u2014 **High**
**Where:** `Dashboard.tsx`, `useTopology`, ad-hoc fetch effects.

Most newer hooks (`useFabricLive`, `useFleetTokenStats`,
`useModelCatalog`) already use `useQuery` / `useQueries` and benefit
from dedup, retry, and `staleTime`.  The legacy polling in
`Dashboard.tsx` is the last hold-out and is responsible for the
"infinite request loop" class of regressions (already hit and fixed
once).

**Proposed fix:** move per-host `nvidia-smi.json` + ollama/sglang/vllm
probes into `useQueries`.  Drop the smart-merge logic in
`setHostsData` (~80 lines) because React Query handles it.

### R-3 \u2014 Error boundary per tab  \u2014 **High**
**Where:** `src/App.tsx` / `src/pages/Dashboard.tsx`.

A render error in any panel takes down the whole dashboard.  We hit
this twice in the last week (the missing `bg-emerald-500` rule
silently rendered an invisible bar; a different render error would
have white-screened everything).

**Proposed fix:** wrap every `<TabsContent>` in a small
`<TabErrorBoundary>` that shows a `Card` with the error message and a
"Retry" button.  ~50 LOC.

### R-4 \u2014 Lift cost catalog onto the central backend  \u2014 **Medium**
**Where:** `server/blueprints/costs.py` (GPU exporter).

Today every GPU exporter fetches the OpenRouter catalog independently
(N parallel outbound requests, N caches).  This is harmless but
wasteful and means we can't add features that require the catalog
during auth flows (e.g. a cost preview on the login page).

**Proposed fix:** move `costs_bp` to `server/central/`.  Frontend hits
`/api/costs/models` directly (no `/api-proxy/` indirection).  Single
cache, single refresh.  ~60 LOC, plus drop the blueprint registration
in `server/app.py`.

### R-5 \u2014 Centralise `liveHosts` derivation  \u2014 **Low**
**Where:** `src/pages/Dashboard.tsx:79` (added in v2.3).

Currently a hand-rolled merge per render.  Once R-1 lands, this goes
away.  Until then, memoise it (`useMemo`) to avoid recomputing the
sorted list on every render.

### R-6 \u2014 Drag-and-drop touch support  \u2014 **Low**
**Where:** `src/components/HostManager.tsx`.

HTML5 drag-and-drop is desktop-only.  Mobile users can't reorder.
Either drop in `@dnd-kit/sortable` (~10 KB) or add up/down arrow
buttons as a fallback.

### R-7 \u2014 Settings page \u2014 split `DashboardAccessCard` to its own file  \u2014 **Info**
**Where:** `src/components/SettingsTab.tsx`.

The password-change UI is 100 LOC and hidden inside `SettingsTab.tsx`.
Move to `src/components/DashboardAccessCard.tsx` for discoverability.

---

## Operability / Robustness

### O-1 \u2014 Zero tests in `src/`  \u2014 **High**
There is no Vitest or Playwright config.  Every regression is caught
by the user.  Past month alone we shipped:
- Topology stale-error (caught visually)
- Power chart stuck on placeholder (caught visually)
- RX bar invisible (caught visually)
- PATCH /api/hosts 404 (caught visually)
- Server 3 crash-loop after deploy (caught visually)

**Proposed fix:** Phase 1 \u2014 Vitest unit tests for `useFleetHosts` and
the storage layer (~20 tests, 1 day).  Phase 2 \u2014 a single Playwright
smoke test that logs in, adds a host, renames it, drags it, and
asserts the resulting URL list (covers \u226550 % of recent regressions).

### O-2 \u2014 Per-host polling fan-out is O(hosts \u00d7 endpoints)  \u2014 **Medium**
The Overview tab polls each host for `/nvidia-smi.json`,
`/api/tokens/stats`, `/api/fabric/live`, `/api/ollama/discover`,
`/api/sglang/discover`, `/api/vllm/discover`, `/api/gpu/processes`,
`/api/topology`.  At 5 s refresh and 10 hosts that's 16 req/s just for
the overview.

**Proposed fix:** add a single aggregated `/api/fleet/snapshot`
endpoint on the central backend that fans out internally with
connection reuse.  Frontend polls one URL.  Drops fan-out by 8\u00d7.
Side benefit: server-side timeouts give cleaner error semantics.

### O-3 \u2014 No structured logging / request IDs  \u2014 **Medium**
Debugging cross-host issues today means SSHing into each container
and grepping by timestamp.

**Proposed fix:** generate `X-Request-ID` in nginx, propagate through
both backends, include in every log line.

### O-4 \u2014 `useTopology` fetches once on mount, never retries  \u2014 **Medium**
**Where:** `src/hooks/useTopology.ts:197`.

If any host is temporarily unreachable on page load, that host's
topology stays missing until the user reloads.  We already hit this
("Server 3 is broken" \u2192 user reloaded to recover).

**Proposed fix:** retry once after 10 s on partial failure; switch to
`useQuery` with `staleTime: 5 * 60_000`.  Migrates naturally as part
of R-2.

### O-5 \u2014 Power chart loses history on refresh  \u2014 **Low**
**Where:** `src/components/PowerUsageChart.tsx`.

`chartData` lives in component state.  Page reload = back to
"Collecting power data\u2026" until 60 s of new samples arrive.

**Proposed fix:** persist the last 60 samples to `localStorage` on
unmount; rehydrate on mount.  ~20 LOC.

### O-6 \u2014 No health probe coverage for downstream services  \u2014 **Low**
The exporter's `/api/health` only checks NVML.  Doesn't report
Ollama/SGLang/vLLM probe status, SQLite write-ability, or disk space.

**Proposed fix:** extend `/api/health` to return a `checks` map and
let the dashboard show a richer "System Status" panel.  ~50 LOC.

### O-7 \u2014 Bare-metal SECRET_KEY warning  \u2014 **Info**
On bare-metal installs (no Docker volume), `.secret_key` lands in the
process's CWD.  If that CWD changes between restarts (e.g. systemd vs
manual run), all sessions invalidate silently.

**Proposed fix:** require `SECRET_KEY` env var on bare-metal; warn
loudly if neither env nor an existing file is found.  ~10 LOC.

---

## Priority shortlist (next sprint)

If picking the top items by ROI:

1. **O-1** (tests) \u2014 highest leverage; every other item gets safer.
2. **R-1** (unify hosts state) \u2014 prevents an entire bug class.
3. **R-3** (error boundaries) \u2014 cheap, big UX win on the next render error.
4. **S-2** (rate limit in SQLite) \u2014 closes a silent foot-gun.
5. **R-4** (cost catalog on central) \u2014 small, clean, removes duplication.
