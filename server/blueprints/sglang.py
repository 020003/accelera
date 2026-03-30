"""SGLang Runtime integration blueprint – discovery and model listing.

Discovery order:
1. If ``SGLANG_URL`` is set (e.g. ``http://localhost:8899``), use it directly.
2. Otherwise, probe ``/v1/models`` on common ports to auto-detect SGLang.

Set ``SGLANG_URL`` in the environment for deterministic, fast discovery.
"""

import logging
import requests as http_requests
from flask import Blueprint, jsonify, request
from urllib.parse import urlparse

from config import SGLANG_URL, SGLANG_DISCOVER_TIMEOUT, SGLANG_DEFAULT_PORT
from utils import is_valid_host_url

log = logging.getLogger(__name__)
sglang_bp = Blueprint("sglang", __name__)

# Ports to auto-probe when SGLANG_URL is not set
_PROBE_PORTS = ["30000", "8000", "8899", "8080", "8888"]

# Track whether we already warned about SGLANG_URL being unreachable
_sglang_url_warned = False


def _probe_sglang(base_url: str, timeout_s: float) -> dict | None:
    """Probe a single URL for a valid SGLang ``/v1/models`` response.

    Returns a result dict on success, or ``None`` on failure.
    """
    try:
        resp = http_requests.get(f"{base_url}/v1/models", timeout=timeout_s)
        if resp.status_code != 200:
            return None

        data = resp.json()
        models_raw = data.get("data", [])
        if not models_raw:
            return None

        models = [
            {
                "id": m.get("id", "unknown"),
                "object": m.get("object", "model"),
                "owned_by": m.get("owned_by", "sglang"),
                "created": m.get("created", 0),
            }
            for m in models_raw
        ]

        # Try to get extra server info (optional, newer SGLang)
        server_info = {}
        try:
            info_resp = http_requests.get(
                f"{base_url}/get_server_info", timeout=timeout_s
            )
            if info_resp.status_code == 200:
                server_info = info_resp.json()
        except Exception:
            pass

        return {
            "isAvailable": True,
            "sglangUrl": base_url,
            "models": models,
            "serverInfo": server_info,
            "statistics": {"totalModels": len(models)},
        }
    except http_requests.RequestException:
        return None


def check_sglang_availability(host_url: str) -> dict:
    """Check if an SGLang Runtime server is reachable on a host.

    If ``SGLANG_URL`` is configured, it is used directly (no port scanning).
    Otherwise, common ports are probed on the same hostname as *host_url*.
    """
    timeout_s = SGLANG_DISCOVER_TIMEOUT / 1000

    # --- Explicit URL (preferred) ---
    global _sglang_url_warned
    if SGLANG_URL:
        log.debug("SGLANG_URL configured: %s", SGLANG_URL)
        result = _probe_sglang(SGLANG_URL.rstrip("/"), timeout_s)
        if result:
            _sglang_url_warned = False
            return result
        if not _sglang_url_warned:
            log.warning("SGLANG_URL=%s did not respond – falling back to port scan", SGLANG_URL)
            _sglang_url_warned = True
        else:
            log.debug("SGLANG_URL=%s still unreachable", SGLANG_URL)

    # --- Auto-discover via port probe ---
    try:
        parsed = urlparse(host_url)
        hostname = parsed.hostname
        scheme = parsed.scheme or "http"

        ports = dict.fromkeys(
            [str(SGLANG_DEFAULT_PORT)] + _PROBE_PORTS + [str(parsed.port or "5000")]
        )

        for port in ports:
            result = _probe_sglang(f"{scheme}://{hostname}:{port}", timeout_s)
            if result:
                log.info("SGLang auto-discovered on port %s", port)
                return result

        return {"isAvailable": False}
    except Exception:
        return {"isAvailable": False}


@sglang_bp.route("/api/sglang/discover", methods=["POST"])
def discover_sglang():
    """Discover SGLang Runtime on a given host URL."""
    data = request.get_json()
    if not data or "hostUrl" not in data:
        return jsonify({"error": "Missing hostUrl"}), 400

    host_url = data["hostUrl"]
    if not is_valid_host_url(host_url):
        return jsonify({"error": "Invalid URL"}), 400

    result = check_sglang_availability(host_url)
    return jsonify(result)
