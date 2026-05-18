"""Accelera Public API — v1.

All endpoints under ``/api/v1`` require::

    Authorization: Bearer acc_<32hex>

Mint a token at /api/auth/tokens (Settings → API Tokens).

Endpoints
---------
    GET  /api/v1                          API index
    GET  /api/v1/whoami                   token metadata
    GET  /api/v1/hosts                    configured fleet members
    GET  /api/v1/fleet/summary            aggregated GPU snapshot
    GET  /api/v1/fleet/tokens             aggregated LLM token usage
    GET  /api/v1/costs/models             cloud-model pricing catalog
    GET  /api/v1/costs/calculate          cost for given token counts
"""

from __future__ import annotations

import concurrent.futures
import logging
import time
from typing import Any
from urllib.parse import urlparse

import requests
from flask import Blueprint, g, jsonify, request

import storage
from api_tokens import api_token_required

log = logging.getLogger(__name__)
api_v1_bp = Blueprint("api_v1", __name__)

HTTP_TIMEOUT = 6.0
FAN_OUT_WORKERS = 8


def _base_url(host_url: str) -> str:
    """Strip trailing /nvidia-smi.json from a stored host URL."""
    return host_url.rstrip("/").removesuffix("/nvidia-smi.json")


def _safe_get_json(url: str, timeout: float = HTTP_TIMEOUT) -> dict | None:
    try:
        # Only allow HTTP/HTTPS exporters reachable on the private net.
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return None
        r = requests.get(url, timeout=timeout,
                         headers={"User-Agent": "accelera-api/1.0"})
        if r.status_code != 200:
            return None
        return r.json()
    except Exception as e:  # noqa: BLE001
        log.debug("fan-out GET %s failed: %s", url, e)
        return None


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------

@api_v1_bp.route("/api/v1", methods=["GET"])
def api_index():
    """Unauthenticated index of available endpoints."""
    return jsonify({
        "name": "Accelera Public API",
        "version": "1",
        "auth": "Authorization: Bearer acc_<token>",
        "manage_tokens": "/api/auth/tokens (session login required)",
        "docs": "/api/v1/docs",
        "openapi": "/api/v1/openapi.json",
        "endpoints": {
            "GET /api/v1/whoami":            "metadata about the calling token",
            "GET /api/v1/hosts":             "configured fleet members",
            "GET /api/v1/fleet/summary":     "aggregated GPU snapshot across the fleet",
            "GET /api/v1/fleet/tokens":      "aggregated LLM token usage (?hours=24)",
            "GET /api/v1/costs/models":      "cloud-model pricing catalog",
            "GET /api/v1/costs/calculate":   "?prompt_tokens=N&completion_tokens=N",
        },
    })


@api_v1_bp.route("/api/v1/whoami", methods=["GET"])
@api_token_required()
def whoami():
    tok = g.api_token
    return jsonify({
        "token_id":   tok["id"],
        "name":       tok["name"],
        "prefix":     tok["prefix"],
        "scopes":     tok["scopes"],
        "created_by": tok["created_by"],
        "expires_at": tok.get("expires_at"),
    })


# ---------------------------------------------------------------------------
# Fleet
# ---------------------------------------------------------------------------

@api_v1_bp.route("/api/v1/hosts", methods=["GET"])
@api_token_required()
def list_hosts():
    """Configured fleet members in display order."""
    return jsonify({"hosts": storage.load_hosts()})


@api_v1_bp.route("/api/v1/fleet/summary", methods=["GET"])
@api_token_required()
def fleet_summary():
    """Live GPU snapshot aggregated across every configured host.

    Fans out to each exporter's ``/nvidia-smi.json`` in parallel.
    Returns per-host detail plus fleet-wide totals.
    """
    hosts = storage.load_hosts()
    if not hosts:
        return jsonify({
            "fetched_at": time.time(),
            "hosts": [],
            "totals": {"gpu_count": 0, "power_w": 0.0, "memory_used_mib": 0,
                       "memory_total_mib": 0, "connected": 0},
        })

    def _fetch(h: dict) -> dict:
        data = _safe_get_json(h["url"])
        if not data:
            return {"url": h["url"], "name": h["name"], "connected": False,
                    "error": "fetch_failed"}
        gpus = []
        for gpu in data.get("gpus", []) or []:
            mem = gpu.get("fb_memory_usage") or {}
            util = gpu.get("utilization") or {}
            gpus.append({
                "index":            gpu.get("minor_number") or gpu.get("index"),
                "name":             gpu.get("product_name") or gpu.get("name"),
                "uuid":             gpu.get("uuid"),
                "utilization_pct":  _to_float(util.get("gpu_util")),
                "memory_used_mib":  _to_int(mem.get("used")),
                "memory_total_mib": _to_int(mem.get("total")),
                "temperature_c":    _to_float((gpu.get("temperature") or {}).get("gpu_temp")),
                "power_w":          _to_float((gpu.get("gpu_power_readings") or {}).get("power_draw")),
            })
        return {
            "url": h["url"], "name": h["name"], "connected": True,
            "timestamp": data.get("timestamp"),
            "driver_version": data.get("driver_version"),
            "cuda_version": data.get("cuda_version"),
            "gpus": gpus,
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=FAN_OUT_WORKERS) as ex:
        results = list(ex.map(_fetch, hosts))

    totals = {"gpu_count": 0, "power_w": 0.0,
              "memory_used_mib": 0, "memory_total_mib": 0, "connected": 0}
    for r in results:
        if not r.get("connected"):
            continue
        totals["connected"] += 1
        for g_ in r.get("gpus", []):
            totals["gpu_count"] += 1
            totals["power_w"] += g_.get("power_w") or 0.0
            totals["memory_used_mib"] += g_.get("memory_used_mib") or 0
            totals["memory_total_mib"] += g_.get("memory_total_mib") or 0
    totals["power_w"] = round(totals["power_w"], 1)

    return jsonify({
        "fetched_at": time.time(),
        "hosts": results,
        "totals": totals,
    })


@api_v1_bp.route("/api/v1/fleet/tokens", methods=["GET"])
@api_token_required()
def fleet_tokens():
    """Aggregated LLM token usage across all hosts.

    Query params:
        hours    integer rolling window (default 24, max 720)
    """
    try:
        hours = int(request.args.get("hours", "24"))
    except (TypeError, ValueError):
        return jsonify({"error": "hours must be an integer"}), 400
    hours = max(1, min(720, hours))

    hosts = storage.load_hosts()
    if not hosts:
        return jsonify({"hours": hours, "hosts": [], "totals": {
            "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
            "cumulative_prompt": 0, "cumulative_generated": 0,
        }})

    def _fetch(h: dict) -> dict:
        url = f"{_base_url(h['url'])}/api/tokens/stats?hours={hours}"
        data = _safe_get_json(url)
        if not data:
            return {"url": h["url"], "name": h["name"], "connected": False}
        s = data.get("summary") or {}
        return {
            "url": h["url"],
            "name": h["name"],
            "connected": True,
            "prompt_tokens":        int(s.get("total_prompt") or 0),
            "completion_tokens":    int(s.get("total_generated") or 0),
            "cumulative_prompt":    int(s.get("cumulative_prompt") or 0),
            "cumulative_generated": int(s.get("cumulative_generated") or 0),
            "by_model": data.get("by_model") or [],
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=FAN_OUT_WORKERS) as ex:
        results = list(ex.map(_fetch, hosts))

    totals = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
              "cumulative_prompt": 0, "cumulative_generated": 0}
    for r in results:
        if not r.get("connected"):
            continue
        totals["prompt_tokens"]        += r["prompt_tokens"]
        totals["completion_tokens"]    += r["completion_tokens"]
        totals["cumulative_prompt"]    += r["cumulative_prompt"]
        totals["cumulative_generated"] += r["cumulative_generated"]
    totals["total_tokens"] = totals["prompt_tokens"] + totals["completion_tokens"]

    return jsonify({"hours": hours, "hosts": results, "totals": totals})


# ---------------------------------------------------------------------------
# Costs (delegate to the same catalog the UI uses)
# ---------------------------------------------------------------------------

@api_v1_bp.route("/api/v1/costs/models", methods=["GET"])
@api_token_required()
def costs_models():
    from costs import _get_catalog  # internal helper; safe in-process
    force = request.args.get("refresh") in ("1", "true", "yes")
    return jsonify(_get_catalog(force=force))


@api_v1_bp.route("/api/v1/costs/calculate", methods=["GET"])
@api_token_required()
def costs_calculate():
    from costs import _get_catalog
    try:
        pt = int(float(request.args.get("prompt_tokens", "0")))
        ct = int(float(request.args.get("completion_tokens", "0")))
    except (TypeError, ValueError):
        return jsonify({"error": "prompt_tokens and completion_tokens must be integers"}), 400
    if pt < 0 or ct < 0:
        return jsonify({"error": "token counts must be non-negative"}), 400

    catalog = _get_catalog()
    rows: list[dict[str, Any]] = []
    for m in catalog["models"]:
        cost_in  = pt * m["prompt_per_mtok"]     / 1_000_000
        cost_out = ct * m["completion_per_mtok"] / 1_000_000
        rows.append({
            **m,
            "cost_prompt_usd":     round(cost_in,  6),
            "cost_completion_usd": round(cost_out, 6),
            "cost_total_usd":      round(cost_in + cost_out, 6),
        })
    rows.sort(key=lambda r: r["cost_total_usd"])
    return jsonify({
        "prompt_tokens": pt,
        "completion_tokens": ct,
        "models": rows,
        "source": catalog["source"],
        "fetched_at": catalog["fetched_at"],
    })


# ---------------------------------------------------------------------------
# Internal coercion helpers
# ---------------------------------------------------------------------------

def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        # Strings like "123 W" / "55 %" / "8192 MiB"
        s = str(v).strip().split()[0]
        return float(s)
    except (ValueError, IndexError):
        return None


def _to_int(v: Any) -> int | None:
    f = _to_float(v)
    return int(f) if f is not None else None
