"""Cloud-model cost catalog (central backend).

Returns a normalised list of commercial LLM API prices so the frontend
can compute "what would this fleet's token usage have cost on Claude
Opus / GPT-4o / Kimi K2 / etc.".

Pricing source
--------------
We pull OpenRouter's public catalog (https://openrouter.ai/api/v1/models)
because it aggregates per-provider pricing for ~300 models in one
JSON document and requires no auth.  Prices arrive in USD per *token*;
we convert to USD per million tokens (the units humans read on
provider pricing pages).

Moved here from the GPU exporter in v2.4 to dedupe N-host outbound
fetches into a single cache served from the same origin as auth.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

import requests
from flask import Blueprint, jsonify, request

from auth import login_required

log = logging.getLogger(__name__)
costs_bp = Blueprint("costs", __name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/models"
CACHE_TTL = int(os.environ.get("COST_CACHE_TTL", "21600"))  # 6h
HTTP_TIMEOUT = float(os.environ.get("COST_HTTP_TIMEOUT", "8"))

_cache_lock = threading.Lock()
_cache: dict[str, Any] = {"models": [], "fetched_at": 0.0, "source": "none"}


# Minimum hand-curated fallback so the tab is never empty.  Prices in
# USD per *million* tokens (input / output), accurate as of mid-2026.
# Only used if the OpenRouter fetch has never succeeded.
FALLBACK_MODELS: list[dict[str, Any]] = [
    {"id": "anthropic/claude-opus-4",     "name": "Claude Opus 4",         "provider": "anthropic", "prompt_per_mtok": 15.0,  "completion_per_mtok": 75.0,  "context": 200000},
    {"id": "anthropic/claude-sonnet-4",   "name": "Claude Sonnet 4",       "provider": "anthropic", "prompt_per_mtok": 3.0,   "completion_per_mtok": 15.0,  "context": 200000},
    {"id": "anthropic/claude-haiku-3.5",  "name": "Claude Haiku 3.5",      "provider": "anthropic", "prompt_per_mtok": 0.80,  "completion_per_mtok": 4.0,   "context": 200000},
    {"id": "openai/gpt-4o",               "name": "GPT-4o",                "provider": "openai",    "prompt_per_mtok": 2.50,  "completion_per_mtok": 10.0,  "context": 128000},
    {"id": "openai/gpt-4o-mini",          "name": "GPT-4o mini",           "provider": "openai",    "prompt_per_mtok": 0.15,  "completion_per_mtok": 0.60,  "context": 128000},
    {"id": "openai/o1",                   "name": "o1",                    "provider": "openai",    "prompt_per_mtok": 15.0,  "completion_per_mtok": 60.0,  "context": 200000},
    {"id": "openai/o3-mini",              "name": "o3-mini",               "provider": "openai",    "prompt_per_mtok": 1.10,  "completion_per_mtok": 4.40,  "context": 200000},
    {"id": "google/gemini-2.5-pro",       "name": "Gemini 2.5 Pro",        "provider": "google",    "prompt_per_mtok": 1.25,  "completion_per_mtok": 10.0,  "context": 1000000},
    {"id": "google/gemini-2.5-flash",     "name": "Gemini 2.5 Flash",      "provider": "google",    "prompt_per_mtok": 0.30,  "completion_per_mtok": 2.50,  "context": 1000000},
    {"id": "moonshotai/kimi-k2",          "name": "Kimi K2",               "provider": "moonshotai","prompt_per_mtok": 0.60,  "completion_per_mtok": 2.50,  "context": 200000},
    {"id": "deepseek/deepseek-v3",        "name": "DeepSeek V3",           "provider": "deepseek",  "prompt_per_mtok": 0.27,  "completion_per_mtok": 1.10,  "context": 64000},
    {"id": "deepseek/deepseek-r1",        "name": "DeepSeek R1",           "provider": "deepseek",  "prompt_per_mtok": 0.55,  "completion_per_mtok": 2.19,  "context": 64000},
    {"id": "meta-llama/llama-3.3-70b",    "name": "Llama 3.3 70B",         "provider": "meta",      "prompt_per_mtok": 0.23,  "completion_per_mtok": 0.40,  "context": 128000},
    {"id": "meta-llama/llama-3.1-405b",   "name": "Llama 3.1 405B",        "provider": "meta",      "prompt_per_mtok": 2.70,  "completion_per_mtok": 2.70,  "context": 128000},
    {"id": "mistralai/mistral-large",     "name": "Mistral Large",         "provider": "mistralai", "prompt_per_mtok": 2.00,  "completion_per_mtok": 6.00,  "context": 128000},
    {"id": "x-ai/grok-2",                 "name": "Grok 2",                "provider": "xai",       "prompt_per_mtok": 2.00,  "completion_per_mtok": 10.0,  "context": 131072},
    {"id": "qwen/qwen-2.5-72b",           "name": "Qwen 2.5 72B",          "provider": "qwen",      "prompt_per_mtok": 0.35,  "completion_per_mtok": 0.40,  "context": 131072},
]


def _normalise_openrouter(payload: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in payload.get("data", []) or []:
        pricing = m.get("pricing") or {}
        try:
            p_in = float(pricing.get("prompt", 0)) * 1_000_000
            p_out = float(pricing.get("completion", 0)) * 1_000_000
        except (TypeError, ValueError):
            continue
        if p_in <= 0 and p_out <= 0:
            continue
        mid = str(m.get("id") or "").strip()
        if not mid:
            continue
        provider = mid.split("/", 1)[0] if "/" in mid else "unknown"
        out.append({
            "id": mid,
            "name": m.get("name") or mid,
            "provider": provider,
            "prompt_per_mtok": round(p_in, 4),
            "completion_per_mtok": round(p_out, 4),
            "context": int(m.get("context_length") or 0) or None,
            "description": (m.get("description") or "").strip()[:240] or None,
        })
    return out


def _refresh_blocking() -> tuple[list[dict[str, Any]], str]:
    """Fetch from OpenRouter; return (models, source).  Falls back to
    the previously-cached or hard-coded list on any error."""
    try:
        r = requests.get(OPENROUTER_URL, timeout=HTTP_TIMEOUT,
                         headers={"User-Agent": "accelera-cost-catalog/1.0"})
        r.raise_for_status()
        models = _normalise_openrouter(r.json())
        if models:
            log.info("Cost catalog refreshed from OpenRouter: %d models", len(models))
            return models, "openrouter"
        raise RuntimeError("empty model list")
    except Exception as e:  # noqa: BLE001
        log.warning("Cost catalog fetch failed (%s); using fallback", e)
        if _cache["models"] and _cache["source"] == "openrouter":
            return _cache["models"], "openrouter-cached"
        return FALLBACK_MODELS, "fallback"


def _get_catalog(force: bool = False) -> dict[str, Any]:
    now = time.time()
    with _cache_lock:
        stale = (now - _cache["fetched_at"]) > CACHE_TTL
        if force or stale or not _cache["models"]:
            models, source = _refresh_blocking()
            _cache.update({"models": models, "fetched_at": now, "source": source})
        return {
            "models": _cache["models"],
            "fetched_at": _cache["fetched_at"],
            "source": _cache["source"],
            "ttl_sec": CACHE_TTL,
            "count": len(_cache["models"]),
        }


@costs_bp.route("/api/costs/models", methods=["GET"])
@login_required
def costs_models():
    """Return the cached model pricing catalog.

    Query params:
      refresh=1   force an upstream re-fetch (bounded by cache TTL)
    """
    force = request.args.get("refresh") in ("1", "true", "yes")
    return jsonify(_get_catalog(force=force))


@costs_bp.route("/api/costs/calculate", methods=["GET"])
@login_required
def costs_calculate():
    """Given prompt + completion token totals, return per-model cost
    breakdowns sorted ascending by total cost.

    Query params (all required):
      prompt_tokens=<int>
      completion_tokens=<int>
    """
    try:
        pt = int(float(request.args.get("prompt_tokens", "0")))
        ct = int(float(request.args.get("completion_tokens", "0")))
    except (TypeError, ValueError):
        return jsonify({"error": "prompt_tokens and completion_tokens must be integers"}), 400
    if pt < 0 or ct < 0:
        return jsonify({"error": "token counts must be non-negative"}), 400

    catalog = _get_catalog()
    rows = []
    for m in catalog["models"]:
        cost_in = pt * m["prompt_per_mtok"] / 1_000_000
        cost_out = ct * m["completion_per_mtok"] / 1_000_000
        rows.append({
            **m,
            "cost_prompt_usd": round(cost_in, 6),
            "cost_completion_usd": round(cost_out, 6),
            "cost_total_usd": round(cost_in + cost_out, 6),
        })
    rows.sort(key=lambda r: r["cost_total_usd"])
    return jsonify({
        "prompt_tokens": pt,
        "completion_tokens": ct,
        "models": rows,
        "source": catalog["source"],
        "fetched_at": catalog["fetched_at"],
    })
