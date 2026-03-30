"""Ollama AI integration blueprint – discovery and performance metrics.

Discovery order:
1. If ``OLLAMA_URL`` is set (e.g. ``http://localhost:11434``), use it directly.
2. Otherwise, probe ``/api/tags`` on common ports to auto-detect Ollama.

Set ``OLLAMA_URL`` in the environment for deterministic, fast discovery.
The legacy ``OLLAMA_HOST`` env var is also accepted as an alias.
"""

import logging
import requests as http_requests
from flask import Blueprint, jsonify, request
from urllib.parse import urlparse

from config import OLLAMA_URL, OLLAMA_DISCOVER_TIMEOUT, OLLAMA_DEFAULT_PORT
from utils import is_valid_host_url

log = logging.getLogger(__name__)
ollama_bp = Blueprint("ollama", __name__)

# Ports to auto-probe when OLLAMA_URL is not set
_PROBE_PORTS = ["11434", "11435", "8080", "3000"]

# Track whether we already warned about OLLAMA_URL being unreachable
_ollama_url_warned = False


def get_ollama_performance_metrics(ollama_url: str) -> dict:
    """Get live runtime metrics from an Ollama instance via ``/api/ps``.

    Only returns data that the Ollama API actually provides (active models
    and VRAM usage).  Token throughput and latency come from the Prometheus
    metrics scraper in ``tokens.py`` — not from here.
    """
    defaults = {
        "activeModels": 0,
        "totalVramUsed": 0,
    }
    try:
        ps_response = http_requests.get(f"{ollama_url}/api/ps", timeout=2)
        if ps_response.status_code == 200:
            ps_data = ps_response.json()
            models_running = ps_data.get("models", [])
            return {
                "activeModels": len(models_running),
                "totalVramUsed": sum(m.get("size_vram", 0) for m in models_running),
            }
    except Exception:
        pass
    return defaults


def _probe_ollama(base_url: str, timeout_s: float) -> dict | None:
    """Probe a single URL for a valid Ollama ``/api/tags`` response.

    Returns a result dict on success, or ``None`` on failure.
    """
    try:
        response = http_requests.get(f"{base_url}/api/tags", timeout=timeout_s)
        if response.status_code != 200:
            return None

        data = response.json()
        if "models" not in data:
            return None

        performance_metrics = get_ollama_performance_metrics(base_url)
        total_size = sum(m.get("size", 0) for m in data["models"])
        model_count = len(data["models"])

        return {
            "isAvailable": True,
            "models": data["models"],
            "performanceMetrics": performance_metrics,
            "recentRequests": [],
            "ollamaUrl": base_url,
            "statistics": {
                "totalModels": model_count,
                "totalSize": total_size,
                "averageModelSize": total_size // model_count if model_count > 0 else 0,
                "largestModel": max((m.get("size", 0) for m in data["models"]), default=0),
            },
        }
    except http_requests.RequestException:
        return None


def check_ollama_availability(host_url: str) -> dict:
    """Check if Ollama is available on a host.

    If ``OLLAMA_URL`` is configured, it is used directly (no port scanning).
    Otherwise, common ports are probed on the same hostname as *host_url*.
    """
    timeout_s = OLLAMA_DISCOVER_TIMEOUT / 1000

    # --- Explicit URL (preferred) ---
    global _ollama_url_warned
    if OLLAMA_URL:
        log.debug("OLLAMA_URL configured: %s", OLLAMA_URL)
        result = _probe_ollama(OLLAMA_URL.rstrip("/"), timeout_s)
        if result:
            _ollama_url_warned = False
            return result
        if not _ollama_url_warned:
            log.warning("OLLAMA_URL=%s did not respond – falling back to port scan", OLLAMA_URL)
            _ollama_url_warned = True
        else:
            log.debug("OLLAMA_URL=%s still unreachable", OLLAMA_URL)

    # --- Auto-discover via port probe ---
    try:
        parsed = urlparse(host_url)
        hostname = parsed.hostname
        scheme = parsed.scheme or "http"

        ports = dict.fromkeys(
            [str(OLLAMA_DEFAULT_PORT)] + _PROBE_PORTS + [str(parsed.port or "5000")]
        )

        for port in ports:
            result = _probe_ollama(f"{scheme}://{hostname}:{port}", timeout_s)
            if result:
                log.info("Ollama auto-discovered on port %s", port)
                return result

        return {"isAvailable": False}
    except Exception:
        return {"isAvailable": False}


@ollama_bp.route("/api/ollama/discover", methods=["POST"])
def discover_ollama():
    """Discover Ollama on a given host URL."""
    data = request.get_json()
    if not data or "hostUrl" not in data:
        return jsonify({"error": "Missing hostUrl"}), 400

    host_url = data["hostUrl"]
    if not is_valid_host_url(host_url):
        return jsonify({"error": "Invalid URL"}), 400

    result = check_ollama_availability(host_url)
    return jsonify(result)
