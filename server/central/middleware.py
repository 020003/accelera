"""Central backend middleware: rate limiting and login lockout."""

import secrets

from flask import Flask, jsonify, request, session

import storage

# ---------------------------------------------------------------------------
# General rate limiter (token-bucket per IP)
# ---------------------------------------------------------------------------
_RATE = 120          # requests per window
_WINDOW = 60         # seconds
_CLEANUP = 300       # prune stale entries every 5 min


def _rate_limited(ip: str) -> bool:
    return storage.is_rate_limited(ip, _RATE, _WINDOW, _CLEANUP)


# ---------------------------------------------------------------------------
# Login lockout (per-IP failed attempt tracking)
# ---------------------------------------------------------------------------
_MAX_FAILURES = 5          # lock after this many consecutive failures
_LOCKOUT_BASE = 30         # base lockout seconds (doubles each time)
_LOCKOUT_MAX = 900         # max lockout: 15 minutes
_LOCKOUT_CLEANUP = 600     # prune stale entries every 10 min


def record_login_failure(ip: str) -> None:
    storage.record_login_failure(ip, _MAX_FAILURES, _LOCKOUT_BASE, _LOCKOUT_MAX)


def clear_login_failures(ip: str) -> None:
    storage.clear_login_failures(ip)


def is_login_locked(ip: str) -> tuple[bool, int]:
    """Return (locked, seconds_remaining)."""
    return storage.get_login_lockout(ip, _LOCKOUT_CLEANUP)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def get_csrf_token() -> str:
    """Return the session-bound CSRF token, creating it on first use."""
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def register_middleware(app: Flask) -> None:
    @app.before_request
    def _check_csrf():
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return None
        if request.path in ("/health", "/api/auth/setup", "/api/auth/login") or request.path.startswith("/api/v1/"):
            return None
        if not session.get("user"):
            return None
        supplied = request.headers.get("X-CSRF-Token", "")
        if not secrets.compare_digest(supplied, get_csrf_token()):
            return jsonify({"error": "CSRF token required"}), 403

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
