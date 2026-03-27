"""SGLang Runtime integration blueprint – discovery and model listing."""

import requests as http_requests
from flask import Blueprint, jsonify, request
from urllib.parse import urlparse

from config import SGLANG_DISCOVER_TIMEOUT, SGLANG_DEFAULT_PORT
from utils import is_valid_host_url

sglang_bp = Blueprint("sglang", __name__)


def check_sglang_availability(host_url: str) -> dict:
    """Check if an SGLang Runtime server is reachable on a host.

    Probes ``/v1/models`` (OpenAI-compatible) on common SGLang ports.
    Returns a dict with ``isAvailable``, ``models``, and ``statistics``.
    """
    try:
        parsed = urlparse(host_url)
        hostname = parsed.hostname
        timeout_s = SGLANG_DISCOVER_TIMEOUT / 1000

        # Ports to try: configured default, then common alternatives
        ports = {str(SGLANG_DEFAULT_PORT), "30000", "8000", "8899", "8080", "8888", str(parsed.port or "5000")}

        for port in ports:
            sglang_url = f"{parsed.scheme}://{hostname}:{port}"
            try:
                resp = http_requests.get(
                    f"{sglang_url}/v1/models", timeout=timeout_s
                )
                if resp.status_code != 200:
                    continue

                data = resp.json()
                models_raw = data.get("data", [])
                if not models_raw:
                    continue

                models = []
                for m in models_raw:
                    models.append({
                        "id": m.get("id", "unknown"),
                        "object": m.get("object", "model"),
                        "owned_by": m.get("owned_by", "sglang"),
                        "created": m.get("created", 0),
                    })

                # Try to get extra server info (optional, newer SGLang)
                server_info = {}
                try:
                    info_resp = http_requests.get(
                        f"{sglang_url}/get_server_info", timeout=timeout_s
                    )
                    if info_resp.status_code == 200:
                        server_info = info_resp.json()
                except Exception:
                    pass

                return {
                    "isAvailable": True,
                    "sglangUrl": sglang_url,
                    "models": models,
                    "serverInfo": server_info,
                    "statistics": {
                        "totalModels": len(models),
                    },
                }
            except http_requests.RequestException:
                continue

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
