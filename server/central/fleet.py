"""Authenticated central fleet snapshot endpoints."""

from __future__ import annotations

import concurrent.futures
import logging
import time
from urllib.parse import urlparse

import requests
from flask import Blueprint, jsonify

import storage
from auth import login_required

log = logging.getLogger(__name__)
fleet_bp = Blueprint("fleet", __name__)

HTTP_TIMEOUT = 5.0
FAN_OUT_WORKERS = 8


def _base_url(host_url: str) -> str:
    return host_url.rstrip("/").removesuffix("/nvidia-smi.json")


def _safe_get_json(url: str) -> dict | None:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return None
        response = requests.get(url, timeout=HTTP_TIMEOUT, headers={"User-Agent": "accelera-central/1.0"})
        if response.status_code != 200:
            return None
        return response.json()
    except Exception as exc:
        log.debug("fleet GET %s failed: %s", url, exc)
        return None


def _safe_post_json(url: str, payload: dict) -> dict | None:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return None
        response = requests.post(
            url,
            json=payload,
            timeout=HTTP_TIMEOUT,
            headers={"User-Agent": "accelera-central/1.0"},
        )
        if response.status_code != 200:
            return None
        return response.json()
    except Exception as exc:
        log.debug("fleet POST %s failed: %s", url, exc)
        return None


def _runtime_snapshot(base_url: str) -> dict:
    result = {}
    payload = {"hostUrl": base_url}
    ollama = _safe_post_json(f"{base_url}/api/ollama/discover", payload)
    if ollama and ollama.get("isAvailable"):
        result["ollama"] = {
            "isAvailable": True,
            "models": ollama.get("models") or [],
            "performanceMetrics": ollama.get("performanceMetrics") or {
                "tokensPerSecond": 0,
                "modelLoadTimeMs": 0,
                "totalDurationMs": 0,
                "promptProcessingMs": 0,
                "averageLatency": 0,
                "requestCount": 0,
                "errorCount": 0,
            },
            "recentRequests": ollama.get("recentRequests") or [],
        }
    sglang = _safe_post_json(f"{base_url}/api/sglang/discover", payload)
    if sglang and sglang.get("isAvailable"):
        result["sglang"] = {
            "isAvailable": True,
            "models": sglang.get("models") or [],
            "sglangUrl": sglang.get("sglangUrl"),
            "serverInfo": sglang.get("serverInfo"),
        }
    vllm = _safe_post_json(f"{base_url}/api/vllm/discover", payload)
    if vllm and vllm.get("isAvailable"):
        result["vllm"] = {
            "isAvailable": True,
            "models": vllm.get("models") or [],
            "vllmUrl": vllm.get("vllmUrl"),
            "vllmUrls": vllm.get("vllmUrls"),
            "version": vllm.get("version"),
            "instances": vllm.get("instances") or [],
        }
    return result


def _fetch_host_snapshot(host: dict) -> dict:
    url = host["url"]
    base_url = _base_url(url)
    data = _safe_get_json(url)
    if not data:
        return {
            "url": url,
            "name": host["name"],
            "isConnected": False,
            "gpus": [],
            "error": "fetch_failed",
        }
    snapshot = {
        "url": url,
        "name": host["name"],
        "isConnected": True,
        "gpus": data.get("gpus") or [],
        "timestamp": data.get("timestamp"),
    }
    snapshot.update(_runtime_snapshot(base_url))
    return snapshot


@fleet_bp.route("/api/fleet/snapshot", methods=["GET"])
@login_required
def fleet_snapshot():
    hosts = storage.load_hosts()
    if not hosts:
        return jsonify({"fetchedAt": time.time(), "hosts": []})
    with concurrent.futures.ThreadPoolExecutor(max_workers=FAN_OUT_WORKERS) as executor:
        snapshots = list(executor.map(_fetch_host_snapshot, hosts))
    return jsonify({"fetchedAt": time.time(), "hosts": snapshots})
