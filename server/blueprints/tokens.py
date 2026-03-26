"""Token usage statistics – scrapes Ollama Prometheus metrics.

Periodically reads ``/metrics`` from the local Ollama instance
(localhost:11434) and stores cumulative counter snapshots in SQLite.
The API endpoint returns delta-based stats for a configurable window.

Endpoints:
  GET /api/tokens/stats?hours=24  — aggregated token statistics
"""

import os
import re

import requests as http_requests
from flask import Blueprint, jsonify, request

import storage

tokens_bp = Blueprint("tokens", __name__)

_OLLAMA_BASE = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
_OLLAMA_METRICS_URL = f"{_OLLAMA_BASE}/metrics"

# Pre-compiled patterns for the Prometheus text format
_RE_GENERATED = re.compile(
    r'^ollama_generated_tokens_total\{model="([^"]+)"\}\s+([\d.]+)', re.M
)
_RE_PROMPT = re.compile(
    r'^ollama_prompt_tokens_total\{model="([^"]+)"\}\s+([\d.]+)', re.M
)
_RE_REQ_DUR_COUNT = re.compile(
    r'^ollama_request_duration_seconds_count\{endpoint="[^"]+",model="([^"]+)"\}\s+([\d.]+)', re.M
)
_RE_REQ_DUR_SUM = re.compile(
    r'^ollama_request_duration_seconds_sum\{endpoint="[^"]+",model="([^"]+)"\}\s+([\d.]+)', re.M
)
_RE_TPT_SUM = re.compile(
    r'^ollama_time_per_token_seconds_sum\{model="([^"]+)"\}\s+([\d.]+)', re.M
)
_RE_TPT_COUNT = re.compile(
    r'^ollama_time_per_token_seconds_count\{model="([^"]+)"\}\s+([\d.]+)', re.M
)


def _parse_metrics(text: str) -> dict[str, dict]:
    """Parse Ollama Prometheus metrics into a per-model dict."""
    models: dict[str, dict] = {}

    def _ensure(m):
        if m not in models:
            models[m] = {
                "generated_tokens": 0,
                "prompt_tokens": 0,
                "request_count": 0,
                "request_duration_sum": 0.0,
                "tpt_sum": 0.0,
                "tpt_count": 0,
            }

    for m in _RE_GENERATED.finditer(text):
        name, val = m.group(1), float(m.group(2))
        _ensure(name)
        models[name]["generated_tokens"] = int(val)

    for m in _RE_PROMPT.finditer(text):
        name, val = m.group(1), float(m.group(2))
        _ensure(name)
        models[name]["prompt_tokens"] = int(val)

    for m in _RE_REQ_DUR_COUNT.finditer(text):
        name, val = m.group(1), float(m.group(2))
        _ensure(name)
        models[name]["request_count"] += int(val)

    for m in _RE_REQ_DUR_SUM.finditer(text):
        name, val = m.group(1), float(m.group(2))
        _ensure(name)
        models[name]["request_duration_sum"] += val

    for m in _RE_TPT_SUM.finditer(text):
        name, val = m.group(1), float(m.group(2))
        _ensure(name)
        models[name]["tpt_sum"] = val

    for m in _RE_TPT_COUNT.finditer(text):
        name, val = m.group(1), float(m.group(2))
        _ensure(name)
        models[name]["tpt_count"] = int(val)

    return models


def collect_token_metrics():
    """Scrape Ollama /metrics and record a snapshot per model."""
    try:
        resp = http_requests.get(_OLLAMA_METRICS_URL, timeout=3)
        if resp.status_code != 200:
            return
        models = _parse_metrics(resp.text)
        for model_name, data in models.items():
            storage.record_token_snapshot(
                model=model_name,
                prompt_tokens=data["prompt_tokens"],
                generated_tokens=data["generated_tokens"],
                request_count=data["request_count"],
                tpt_sum=data["tpt_sum"],
                tpt_count=data["tpt_count"],
                req_dur_sum=data["request_duration_sum"],
            )
    except Exception:
        pass


@tokens_bp.route("/api/tokens/stats", methods=["GET"])
def token_stats():
    """Return token usage statistics for the requested window."""
    hours = request.args.get("hours", 24, type=int)
    hours = min(max(hours, 1), 168)  # clamp 1h–7d
    stats = storage.get_token_stats(hours)
    return jsonify(stats)
