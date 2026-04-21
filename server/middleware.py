"""Lightweight middleware: rate limiting and global error handlers.

No external dependencies — uses an in-memory token-bucket per IP.
"""

import logging
import time
import threading
from collections import defaultdict

from flask import Flask, jsonify, request

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Rate limiter (token-bucket per IP)
# ---------------------------------------------------------------------------

_DEFAULT_RATE = 600       # requests per window (multiple dashboards + hooks)
_DEFAULT_WINDOW = 60      # seconds
_CLEANUP_INTERVAL = 300   # prune stale entries every 5 min

_buckets: dict[str, list] = defaultdict(lambda: [0, 0.0])  # [tokens_used, window_start]
_lock = threading.Lock()
_last_cleanup = 0.0


def _rate_limited(ip: str, rate: int = _DEFAULT_RATE, window: int = _DEFAULT_WINDOW) -> bool:
    """Return True if *ip* has exceeded *rate* requests in the current *window*."""
    global _last_cleanup
    now = time.monotonic()

    with _lock:
        # Periodic cleanup of stale buckets
        if now - _last_cleanup > _CLEANUP_INTERVAL:
            stale = [k for k, v in _buckets.items() if now - v[1] > window * 2]
            for k in stale:
                del _buckets[k]
            _last_cleanup = now

        bucket = _buckets[ip]
        if now - bucket[1] > window:
            # Reset window
            bucket[0] = 1
            bucket[1] = now
            return False

        bucket[0] += 1
        return bucket[0] > rate


def register_middleware(app: Flask):
    """Attach rate limiter and global error handlers to *app*."""

    # ── Rate limiting ──────────────────────────────────────────────
    @app.before_request
    def _check_rate_limit():
        # Skip rate limiting for health checks
        if request.path in ("/health", "/api/health"):
            return None
        ip = request.remote_addr or "unknown"
        if _rate_limited(ip):
            return jsonify({"error": "Rate limit exceeded", "status": 429}), 429

    # ── Global error handlers ──────────────────────────────────────
    @app.errorhandler(400)
    def _bad_request(e):
        return jsonify({"error": str(e), "status": 400}), 400

    @app.errorhandler(404)
    def _not_found(e):
        return jsonify({"error": "Not found", "status": 404}), 404

    @app.errorhandler(405)
    def _method_not_allowed(e):
        return jsonify({"error": "Method not allowed", "status": 405}), 405

    @app.errorhandler(500)
    def _internal_error(e):
        log.exception("Unhandled server error")
        return jsonify({"error": "Internal server error", "status": 500}), 500
