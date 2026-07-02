"""Authenticated central fleet snapshot endpoints."""

from __future__ import annotations

import concurrent.futures
import copy
import logging
import os
import threading
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
CACHE_TTL_SECONDS = float(os.environ.get("FLEET_SNAPSHOT_CACHE_TTL_SECONDS", "2"))

_cache_lock = threading.Lock()
_host_cache: dict[str, dict] = {}


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


def _decorate_snapshot(snapshot: dict, now: float, source: str, stale: bool = False) -> dict:
    result = copy.deepcopy(snapshot)
    result["snapshotSource"] = source
    result["stale"] = stale
    result["cacheAgeSeconds"] = round(max(0.0, now - result.get("fetchedAt", now)), 3)
    return result


def _cached_snapshot(url: str, now: float) -> dict | None:
    with _cache_lock:
        cached = _host_cache.get(url)
        if not cached:
            return None
        if now - cached["fetchedAt"] > CACHE_TTL_SECONDS:
            return None
        return _decorate_snapshot(cached["snapshot"], now, "cache")


def _stale_snapshot(url: str, host_name: str, now: float, error: str, fetch_duration_ms: int) -> dict | None:
    with _cache_lock:
        cached = _host_cache.get(url)
        if not cached:
            return None
        snapshot = _decorate_snapshot(cached["snapshot"], now, "stale-cache", True)
    snapshot["name"] = host_name
    snapshot["isConnected"] = False
    snapshot["error"] = error
    snapshot["fetchDurationMs"] = fetch_duration_ms
    return snapshot


def _store_snapshot(url: str, snapshot: dict) -> None:
    with _cache_lock:
        _host_cache[url] = {"fetchedAt": snapshot["fetchedAt"], "snapshot": copy.deepcopy(snapshot)}


def _fetch_host_snapshot_uncached(host: dict) -> dict:
    url = host["url"]
    base_url = _base_url(url)
    started_at = time.perf_counter()
    fetched_at = time.time()
    data = _safe_get_json(url)
    fetch_duration_ms = int((time.perf_counter() - started_at) * 1000)
    if not data:
        stale = _stale_snapshot(url, host["name"], fetched_at, "fetch_failed", fetch_duration_ms)
        if stale:
            return stale
        return {
            "url": url,
            "name": host["name"],
            "isConnected": False,
            "gpus": [],
            "error": "fetch_failed",
            "fetchedAt": fetched_at,
            "fetchDurationMs": fetch_duration_ms,
            "snapshotSource": "live",
            "stale": False,
            "cacheAgeSeconds": 0.0,
        }
    snapshot = {
        "url": url,
        "name": host["name"],
        "isConnected": True,
        "gpus": data.get("gpus") or [],
        "timestamp": data.get("timestamp"),
        "fetchedAt": fetched_at,
        "lastSuccessAt": fetched_at,
        "fetchDurationMs": fetch_duration_ms,
        "snapshotSource": "live",
        "stale": False,
        "cacheAgeSeconds": 0.0,
    }
    snapshot.update(_runtime_snapshot(base_url))
    snapshot["fetchDurationMs"] = int((time.perf_counter() - started_at) * 1000)
    _store_snapshot(url, snapshot)
    return snapshot


def _fetch_host_snapshot(host: dict) -> dict:
    now = time.time()
    cached = _cached_snapshot(host["url"], now)
    if cached:
        cached["name"] = host["name"]
        return cached
    return _fetch_host_snapshot_uncached(host)


@fleet_bp.route("/api/fleet/snapshot", methods=["GET"])
@login_required
def fleet_snapshot():
    started_at = time.perf_counter()
    fetched_at = time.time()
    hosts = storage.load_hosts()
    if not hosts:
        return jsonify({
            "fetchedAt": fetched_at,
            "fetchDurationMs": 0,
            "cacheTtlSeconds": CACHE_TTL_SECONDS,
            "hosts": [],
        })
    with concurrent.futures.ThreadPoolExecutor(max_workers=FAN_OUT_WORKERS) as executor:
        snapshots = list(executor.map(_fetch_host_snapshot, hosts))
    return jsonify({
        "fetchedAt": fetched_at,
        "fetchDurationMs": int((time.perf_counter() - started_at) * 1000),
        "cacheTtlSeconds": CACHE_TTL_SECONDS,
        "hosts": snapshots,
    })
