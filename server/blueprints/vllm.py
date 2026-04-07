"""vLLM integration blueprint – discovery and model listing.

Discovery order:
1. If ``VLLM_URL`` is set (e.g. ``http://localhost:8000``), use it directly.
2. Otherwise, probe ``/version`` + ``/v1/models`` on common ports to auto-detect vLLM.

vLLM is distinguished from SGLang by the presence of the ``/version`` endpoint
and ``owned_by: "vllm"`` in model metadata.

Set ``VLLM_URL`` in the environment for deterministic, fast discovery.
"""

import logging
import requests as http_requests
from flask import Blueprint, jsonify, request
from urllib.parse import urlparse

from config import VLLM_URL, VLLM_DISCOVER_TIMEOUT, VLLM_DEFAULT_PORT
from utils import is_valid_host_url

log = logging.getLogger(__name__)
vllm_bp = Blueprint("vllm", __name__)

# Ports to auto-probe when VLLM_URL is not set
_PROBE_PORTS = ["8000", "8001", "8002", "8003", "8080", "8888", "5000"]

# Track whether we already warned about VLLM_URL being unreachable
_vllm_url_warned = False


def _is_vllm(base_url: str, timeout_s: float) -> dict | None:
    """Check if a URL is a vLLM server by probing ``/version``.

    Returns version info dict on success, or ``None`` if not vLLM.
    """
    try:
        resp = http_requests.get(f"{base_url}/version", timeout=timeout_s)
        if resp.status_code == 200:
            data = resp.json()
            if "version" in data:
                return data
    except Exception:
        pass
    return None


def _probe_vllm(base_url: str, timeout_s: float) -> dict | None:
    """Probe a single URL for a valid vLLM server.

    Checks ``/version`` first (vLLM-specific), then ``/v1/models``.
    Returns a result dict on success, or ``None`` on failure.
    """
    # Step 1: Confirm this is vLLM via /version
    version_info = _is_vllm(base_url, timeout_s)
    if not version_info:
        return None

    # Step 2: Fetch models via /v1/models
    try:
        resp = http_requests.get(f"{base_url}/v1/models", timeout=timeout_s)
        if resp.status_code != 200:
            # vLLM is running but no models endpoint — still report it
            return {
                "isAvailable": True,
                "vllmUrl": base_url,
                "models": [],
                "version": version_info.get("version", "unknown"),
                "statistics": {"totalModels": 0},
            }

        data = resp.json()
        models_raw = data.get("data", [])

        models = [
            {
                "id": m.get("id", "unknown"),
                "object": m.get("object", "model"),
                "owned_by": m.get("owned_by", "vllm"),
                "created": m.get("created", 0),
                "max_model_len": m.get("max_model_len", 0),
            }
            for m in models_raw
        ]

        return {
            "isAvailable": True,
            "vllmUrl": base_url,
            "models": models,
            "version": version_info.get("version", "unknown"),
            "statistics": {"totalModels": len(models)},
        }
    except http_requests.RequestException:
        return None


def check_vllm_availability(host_url: str) -> dict:
    """Check if a vLLM server is reachable on a host.

    If ``VLLM_URL`` is configured, it is used directly (no port scanning).
    Otherwise, common ports are probed on the same hostname as *host_url*.
    """
    timeout_s = VLLM_DISCOVER_TIMEOUT / 1000

    # --- Explicit URL (preferred) ---
    global _vllm_url_warned
    if VLLM_URL:
        log.debug("VLLM_URL configured: %s", VLLM_URL)
        result = _probe_vllm(VLLM_URL.rstrip("/"), timeout_s)
        if result:
            _vllm_url_warned = False
            return result
        if not _vllm_url_warned:
            log.warning("VLLM_URL=%s did not respond – falling back to port scan", VLLM_URL)
            _vllm_url_warned = True
        else:
            log.debug("VLLM_URL=%s still unreachable", VLLM_URL)

    # --- Auto-discover via port probe ---
    try:
        parsed = urlparse(host_url)
        hostname = parsed.hostname
        scheme = parsed.scheme or "http"

        ports = list(dict.fromkeys(
            [str(VLLM_DEFAULT_PORT)] + _PROBE_PORTS + [str(parsed.port or "5000")]
        ))

        # Build list of hostnames to scan.  When running inside a
        # container, localhost won't reach host services – also probe
        # host.docker.internal.  Similarly, if VLLM_URL pointed to a
        # specific hostname, scan all ports on that hostname too.
        hostnames: list[str] = [hostname] if hostname else ["localhost"]
        if hostname in ("localhost", "127.0.0.1"):
            hostnames.append("host.docker.internal")
        if VLLM_URL:
            vllm_host = urlparse(VLLM_URL).hostname
            if vllm_host and vllm_host not in hostnames:
                hostnames.append(vllm_host)

        for h in hostnames:
            for port in ports:
                result = _probe_vllm(f"{scheme}://{h}:{port}", timeout_s)
                if result:
                    log.info("vLLM auto-discovered on %s:%s", h, port)
                    return result

        return {"isAvailable": False}
    except Exception:
        return {"isAvailable": False}


@vllm_bp.route("/api/vllm/discover", methods=["POST"])
def discover_vllm():
    """Discover vLLM on a given host URL."""
    data = request.get_json()
    if not data or "hostUrl" not in data:
        return jsonify({"error": "Missing hostUrl"}), 400

    host_url = data["hostUrl"]
    if not is_valid_host_url(host_url):
        return jsonify({"error": "Invalid URL"}), 400

    result = check_vllm_availability(host_url)
    return jsonify(result)
