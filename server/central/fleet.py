"""Authenticated central fleet snapshot endpoints."""

from __future__ import annotations

import concurrent.futures
import copy
import logging
import os
import threading
import time
import requests
from flask import Blueprint, jsonify

import storage
from auth import login_required
from host_policy import validate_exporter_url

log = logging.getLogger(__name__)
fleet_bp = Blueprint("fleet", __name__)

HTTP_TIMEOUT = 5.0
FAN_OUT_WORKERS = 8
CACHE_TTL_SECONDS = float(os.environ.get("FLEET_SNAPSHOT_CACHE_TTL_SECONDS", "0.5"))
RUNTIME_CACHE_TTL_SECONDS = float(os.environ.get("FLEET_RUNTIME_CACHE_TTL_SECONDS", "300"))
FABRIC_CACHE_TTL_SECONDS = float(os.environ.get("FLEET_FABRIC_CACHE_TTL_SECONDS", "2"))
EXPORTER_AUTH_TOKEN = os.environ.get("EXPORTER_AUTH_TOKEN", "")
STALE_ALERT_SECONDS = float(os.environ.get("FLEET_STALE_ALERT_SECONDS", "15"))
OFFLINE_ALERT_SECONDS = float(os.environ.get("FLEET_OFFLINE_ALERT_SECONDS", "30"))

_cache_lock = threading.Lock()
_host_cache: dict[str, dict] = {}
_runtime_cache: dict[str, dict] = {}
_fabric_cache: dict[str, dict] = {}
_host_status: dict[str, dict] = {}


def _base_url(host_url: str) -> str:
    return host_url.rstrip("/").removesuffix("/nvidia-smi.json")


def _request_headers() -> dict:
    headers = {"User-Agent": "accelera-central/1.0"}
    if EXPORTER_AUTH_TOKEN:
        headers["Authorization"] = f"Bearer {EXPORTER_AUTH_TOKEN}"
    return headers


def _safe_get_json(url: str) -> dict | None:
    try:
        validated = validate_exporter_url(url)
        response = requests.get(
            validated.value,
            timeout=HTTP_TIMEOUT,
            headers=_request_headers(),
            allow_redirects=False,
        )
        if response.status_code != 200:
            return None
        return response.json()
    except Exception as exc:
        log.debug("fleet GET %s failed: %s", url, exc)
        return None


def _safe_post_json(url: str, payload: dict) -> dict | None:
    try:
        validated = validate_exporter_url(url)
        response = requests.post(
            validated.value,
            json=payload,
            timeout=HTTP_TIMEOUT,
            headers=_request_headers(),
            allow_redirects=False,
        )
        if response.status_code != 200:
            return None
        return response.json()
    except Exception as exc:
        log.debug("fleet POST %s failed: %s", url, exc)
        return None


def _fabric_snapshot(host: dict) -> dict:
    now = time.time()
    url = host["url"]
    with _cache_lock:
        cached = _fabric_cache.get(url)
        if cached and now - cached["fetchedAt"] <= FABRIC_CACHE_TTL_SECONDS:
            return copy.deepcopy(cached["payload"])

    started_at = time.perf_counter()
    payload = _safe_get_json(f"{_base_url(url)}/api/fabric/live")
    result = {
        "url": url,
        "name": host["name"],
        "fetchedAt": now,
        "fetchDurationMs": int((time.perf_counter() - started_at) * 1000),
        "isConnected": payload is not None,
    }
    if payload is None:
        result["error"] = "fetch_failed"
    else:
        result.update(payload)

    with _cache_lock:
        _fabric_cache[url] = {"fetchedAt": now, "payload": copy.deepcopy(result)}
    return result


def _runtime_snapshot_uncached(base_url: str) -> dict:
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


def _runtime_snapshot(base_url: str) -> dict:
    now = time.time()
    with _cache_lock:
        cached = _runtime_cache.get(base_url)
        if cached and now - cached["fetchedAt"] <= RUNTIME_CACHE_TTL_SECONDS:
            return copy.deepcopy(cached["snapshot"])
    snapshot = _runtime_snapshot_uncached(base_url)
    with _cache_lock:
        _runtime_cache[base_url] = {"fetchedAt": now, "snapshot": copy.deepcopy(snapshot)}
    return snapshot


def _runtime_snapshot_with_metadata(host: dict) -> dict:
    now = time.time()
    base_url = _base_url(host["url"])
    snapshot = _runtime_snapshot(base_url)
    with _cache_lock:
        cached = _runtime_cache.get(base_url, {})
        fetched_at = cached.get("fetchedAt", now)
    result = {
        "url": host["url"],
        "name": host["name"],
        "fetchedAt": fetched_at,
        "cacheAgeSeconds": round(max(0.0, now - fetched_at), 3),
    }
    result.update(snapshot)
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


def _remember_host_status(snapshot: dict) -> None:
    with _cache_lock:
        _host_status[snapshot["url"]] = {
            "url": snapshot["url"],
            "name": snapshot.get("name"),
            "isConnected": snapshot.get("isConnected", False),
            "snapshotSource": snapshot.get("snapshotSource"),
            "stale": snapshot.get("stale", False),
            "error": snapshot.get("error"),
            "fetchedAt": snapshot.get("fetchedAt"),
            "lastSuccessAt": snapshot.get("lastSuccessAt"),
            "fetchDurationMs": snapshot.get("fetchDurationMs"),
            "cacheAgeSeconds": snapshot.get("cacheAgeSeconds", 0.0),
            "gpuCount": len(snapshot.get("gpus") or []),
        }


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
    _remember_host_status(snapshot)
    return snapshot


def _store_snapshot(url: str, snapshot: dict) -> None:
    with _cache_lock:
        _host_cache[url] = {"fetchedAt": snapshot["fetchedAt"], "snapshot": copy.deepcopy(snapshot)}
    _remember_host_status(snapshot)


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
        snapshot = {
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
        _remember_host_status(snapshot)
        return snapshot
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
        _remember_host_status(cached)
        return cached
    return _fetch_host_snapshot_uncached(host)


def _freshness_summary(snapshots: list[dict], now: float) -> dict:
    cache_ages = [float(host.get("cacheAgeSeconds", 0.0)) for host in snapshots]
    sample_ages = [max(0.0, now - host.get("fetchedAt", now)) for host in snapshots if host.get("fetchedAt")]
    return {
        "totalHosts": len(snapshots),
        "onlineHosts": sum(1 for host in snapshots if host.get("isConnected")),
        "offlineHosts": sum(1 for host in snapshots if not host.get("isConnected")),
        "liveHosts": sum(1 for host in snapshots if host.get("snapshotSource") == "live" and not host.get("stale")),
        "cachedHosts": sum(1 for host in snapshots if host.get("snapshotSource") == "cache"),
        "staleHosts": sum(1 for host in snapshots if host.get("stale")),
        "oldestCacheAgeSeconds": round(max(cache_ages), 3) if cache_ages else 0.0,
        "oldestSampleAgeSeconds": round(max(sample_ages), 3) if sample_ages else 0.0,
    }


def _fleet_alerts(snapshots: list[dict], now: float) -> list[dict]:
    alerts = []
    for host in snapshots:
        age = max(0.0, now - host.get("fetchedAt", now)) if host.get("fetchedAt") else 0.0
        if not host.get("isConnected") and age >= OFFLINE_ALERT_SECONDS:
            alerts.append({
                "type": "offline",
                "severity": "critical",
                "host": host.get("name"),
                "url": host.get("url"),
                "ageSeconds": round(age, 3),
            })
        elif host.get("stale") or age >= STALE_ALERT_SECONDS:
            alerts.append({
                "type": "stale",
                "severity": "warning",
                "host": host.get("name"),
                "url": host.get("url"),
                "ageSeconds": round(age, 3),
            })
    return alerts


def _diagnostics(now: float) -> dict:
    hosts = storage.load_hosts()
    with _cache_lock:
        host_cache = copy.deepcopy(_host_cache)
        runtime_cache = copy.deepcopy(_runtime_cache)
        host_status = copy.deepcopy(_host_status)
    host_rows = []
    for host in hosts:
        url = host["url"]
        base_url = _base_url(url)
        cached = host_cache.get(url)
        runtime = runtime_cache.get(base_url)
        status = host_status.get(url, {})
        host_rows.append({
            "url": url,
            "name": host["name"],
            "isConnected": status.get("isConnected", False),
            "snapshotSource": status.get("snapshotSource"),
            "stale": status.get("stale", False),
            "error": status.get("error"),
            "gpuCount": status.get("gpuCount", 0),
            "fetchDurationMs": status.get("fetchDurationMs"),
            "fetchedAt": status.get("fetchedAt"),
            "lastSuccessAt": status.get("lastSuccessAt"),
            "hostCacheAgeSeconds": round(max(0.0, now - cached["fetchedAt"]), 3) if cached else None,
            "runtimeCacheAgeSeconds": round(max(0.0, now - runtime["fetchedAt"]), 3) if runtime else None,
        })
    return {
        "generatedAt": now,
        "cacheTtlSeconds": CACHE_TTL_SECONDS,
        "runtimeCacheTtlSeconds": RUNTIME_CACHE_TTL_SECONDS,
        "exporterAuthConfigured": bool(EXPORTER_AUTH_TOKEN),
        "hostCacheSize": len(host_cache),
        "runtimeCacheSize": len(runtime_cache),
        "hosts": host_rows,
    }


@fleet_bp.route("/api/fleet/fabric", methods=["GET"])
@login_required
def fleet_fabric():
    started_at = time.perf_counter()
    fetched_at = time.time()
    hosts = storage.load_hosts()
    with concurrent.futures.ThreadPoolExecutor(max_workers=FAN_OUT_WORKERS) as executor:
        fabric_hosts = list(executor.map(_fabric_snapshot, hosts))
    return jsonify({
        "fetchedAt": fetched_at,
        "fetchDurationMs": int((time.perf_counter() - started_at) * 1000),
        "cacheTtlSeconds": FABRIC_CACHE_TTL_SECONDS,
        "hosts": fabric_hosts,
    })


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
            "runtimeCacheTtlSeconds": RUNTIME_CACHE_TTL_SECONDS,
            "freshness": _freshness_summary([], fetched_at),
            "alerts": [],
            "hosts": [],
        })
    with concurrent.futures.ThreadPoolExecutor(max_workers=FAN_OUT_WORKERS) as executor:
        snapshots = list(executor.map(_fetch_host_snapshot, hosts))
    finished_at = time.time()
    return jsonify({
        "fetchedAt": fetched_at,
        "fetchDurationMs": int((time.perf_counter() - started_at) * 1000),
        "cacheTtlSeconds": CACHE_TTL_SECONDS,
        "runtimeCacheTtlSeconds": RUNTIME_CACHE_TTL_SECONDS,
        "freshness": _freshness_summary(snapshots, finished_at),
        "alerts": _fleet_alerts(snapshots, finished_at),
        "hosts": snapshots,
    })


@fleet_bp.route("/api/fleet/runtime", methods=["GET"])
@login_required
def fleet_runtime():
    started_at = time.perf_counter()
    fetched_at = time.time()
    hosts = storage.load_hosts()
    with concurrent.futures.ThreadPoolExecutor(max_workers=FAN_OUT_WORKERS) as executor:
        runtime_hosts = list(executor.map(_runtime_snapshot_with_metadata, hosts))
    return jsonify({
        "fetchedAt": fetched_at,
        "fetchDurationMs": int((time.perf_counter() - started_at) * 1000),
        "runtimeCacheTtlSeconds": RUNTIME_CACHE_TTL_SECONDS,
        "hosts": runtime_hosts,
    })


@fleet_bp.route("/api/fleet/snapshot/diagnostics", methods=["GET"])
@login_required
def fleet_snapshot_diagnostics():
    return jsonify(_diagnostics(time.time()))
