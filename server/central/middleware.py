"""Central backend middleware: rate limiting and login lockout.

In-memory token-bucket per IP for general rate limiting.
Separate stricter limit + exponential backoff for auth endpoints.
"""

import threading
import time
from collections import defaultdict

from flask import Flask, jsonify, request

# ---------------------------------------------------------------------------
# General rate limiter (token-bucket per IP)
# ---------------------------------------------------------------------------
_RATE = 120          # requests per window
_WINDOW = 60         # seconds
_CLEANUP = 300       # prune stale entries every 5 min

_lock = threading.Lock()
_buckets: dict[str, list] = defaultdict(lambda: [0, 0.0])  # [count, window_start]
_last_cleanup = 0.0


def _rate_limited(ip: str) -> bool:
    global _last_cleanup
    now = time.monotonic()
    with _lock:
        if now - _last_cleanup > _CLEANUP:
            stale = [k for k, v in _buckets.items() if now - v[1] > _WINDOW * 2]
            for k in stale:
                del _buckets[k]
            _last_cleanup = now

        bucket = _buckets[ip]
        if now - bucket[1] > _WINDOW:
            bucket[0] = 1
            bucket[1] = now
            return False
        bucket[0] += 1
        return bucket[0] > _RATE


# ---------------------------------------------------------------------------
# Login lockout (per-IP failed attempt tracking)
# ---------------------------------------------------------------------------
_MAX_FAILURES = 5          # lock after this many consecutive failures
_LOCKOUT_BASE = 30         # base lockout seconds (doubles each time)
_LOCKOUT_MAX = 900         # max lockout: 15 minutes
_LOCKOUT_CLEANUP = 600     # prune stale entries every 10 min

_login_lock = threading.Lock()
_login_failures: dict[str, dict] = {}  # ip -> {count, locked_until, last_failure}
_login_last_cleanup = 0.0


def record_login_failure(ip: str) -> None:
    now = time.monotonic()
    with _login_lock:
        entry = _login_failures.setdefault(ip, {"count": 0, "locked_until": 0, "last_failure": 0})
        entry["count"] += 1
        entry["last_failure"] = now
        if entry["count"] >= _MAX_FAILURES:
            backoff = min(_LOCKOUT_BASE * (2 ** (entry["count"] - _MAX_FAILURES)), _LOCKOUT_MAX)
            entry["locked_until"] = now + backoff


def clear_login_failures(ip: str) -> None:
    with _login_lock:
        _login_failures.pop(ip, None)


def is_login_locked(ip: str) -> tuple[bool, int]:
    """Return (locked, seconds_remaining)."""
    now = time.monotonic()
    with _login_lock:
        # Periodic cleanup
        global _login_last_cleanup
        if now - _login_last_cleanup > _LOCKOUT_CLEANUP:
            stale = [k for k, v in _login_failures.items()
                     if now - v["last_failure"] > _LOCKOUT_MAX * 2]
            for k in stale:
                del _login_failures[k]
            _login_last_cleanup = now

        entry = _login_failures.get(ip)
        if not entry:
            return False, 0
        remaining = entry["locked_until"] - now
        if remaining > 0:
            return True, int(remaining) + 1
        return False, 0


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_middleware(app: Flask) -> None:
    @app.before_request
    def _check_rate_limit():
        if request.path in ("/health",):
            return None
        ip = request.headers.get("X-Real-IP") or request.remote_addr or "unknown"
        if _rate_limited(ip):
            return jsonify({"error": "Rate limit exceeded"}), 429

    @app.before_request
    def _check_login_lockout():
        if request.path != "/api/auth/login" or request.method != "POST":
            return None
        ip = request.headers.get("X-Real-IP") or request.remote_addr or "unknown"
        locked, remaining = is_login_locked(ip)
        if locked:
            return jsonify({
                "error": f"Too many failed attempts. Try again in {remaining}s",
                "retry_after": remaining,
            }), 429
