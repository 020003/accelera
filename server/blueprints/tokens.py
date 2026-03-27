"""Token usage statistics – scrapes Ollama & SGLang Prometheus metrics.

Periodically reads ``/metrics`` from the local Ollama instance
(localhost:11434) and SGLang instances, storing cumulative counter
snapshots in SQLite.  The API endpoint returns delta-based stats for a
configurable window.

Endpoints:
  GET /api/tokens/stats?hours=24  — aggregated token statistics
"""

import os
import re

import requests as http_requests
from flask import Blueprint, jsonify, request

import storage
from config import SGLANG_DEFAULT_PORT

tokens_bp = Blueprint("tokens", __name__)

# ---------------------------------------------------------------------------
# Ollama metrics
# ---------------------------------------------------------------------------
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


def _parse_ollama_metrics(text: str) -> dict[str, dict]:
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


def _collect_ollama():
    """Scrape Ollama /metrics and record a snapshot per model."""
    try:
        resp = http_requests.get(_OLLAMA_METRICS_URL, timeout=3)
        if resp.status_code != 200:
            return
        models = _parse_ollama_metrics(resp.text)
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


# ---------------------------------------------------------------------------
# SGLang metrics
# ---------------------------------------------------------------------------
_SGLANG_HOST = os.environ.get("SGLANG_HOST", "http://localhost").rstrip("/")
_SGLANG_PORT = os.environ.get("SGLANG_PORT", str(SGLANG_DEFAULT_PORT))
_SGLANG_METRICS_URL = f"{_SGLANG_HOST}:{_SGLANG_PORT}/metrics"

# SGLang Prometheus metric patterns (covers multiple SGLang versions)
_RE_SG_GEN = re.compile(
    r'^sglang[_:]generation_tokens_total(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_SG_PROMPT = re.compile(
    r'^sglang[_:]prompt_tokens_total(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_SG_REQUESTS = re.compile(
    r'^sglang[_:](?:num_requests_total|requests_total)(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_SG_E2E_SUM = re.compile(
    r'^sglang[_:]e2e_request_latency_seconds_sum(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_SG_E2E_COUNT = re.compile(
    r'^sglang[_:]e2e_request_latency_seconds_count(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_SG_TTFT_SUM = re.compile(
    r'^sglang[_:]time_to_first_token_seconds_sum(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_SG_TTFT_COUNT = re.compile(
    r'^sglang[_:]time_to_first_token_seconds_count(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
# Fallback: generic output/input tokens (some SGLang builds)
_RE_SG_OUTPUT = re.compile(
    r'^sglang[_:](?:output|completion)_tokens_total(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_SG_INPUT = re.compile(
    r'^sglang[_:](?:input|prompt)_tokens_total(?:\{[^}]*\})?\s+([\d.]+)', re.M
)


def _get_sglang_model_name() -> str:
    """Best-effort fetch of the model name from SGLang /v1/models."""
    try:
        resp = http_requests.get(
            f"{_SGLANG_HOST}:{_SGLANG_PORT}/v1/models", timeout=2
        )
        if resp.status_code == 200:
            data = resp.json()
            models = data.get("data", [])
            if models:
                return models[0].get("id", "sglang-model")
    except Exception:
        pass
    return "sglang-model"


def _parse_sglang_metrics(text: str) -> dict | None:
    """Parse SGLang Prometheus metrics into a single model dict.

    SGLang typically serves one model at a time, so we aggregate all
    counters into a single entry keyed by the model name.
    """
    gen = 0
    prompt = 0
    req_count = 0
    dur_sum = 0.0
    tpt_sum = 0.0
    tpt_count = 0

    # Generation / output tokens
    for m in _RE_SG_GEN.finditer(text):
        gen += int(float(m.group(1)))
    if gen == 0:
        for m in _RE_SG_OUTPUT.finditer(text):
            gen += int(float(m.group(1)))

    # Prompt / input tokens
    for m in _RE_SG_PROMPT.finditer(text):
        prompt += int(float(m.group(1)))
    if prompt == 0:
        for m in _RE_SG_INPUT.finditer(text):
            prompt += int(float(m.group(1)))

    # If no token counters found at all, nothing to record
    if gen == 0 and prompt == 0:
        return None

    # Request count
    for m in _RE_SG_REQUESTS.finditer(text):
        req_count += int(float(m.group(1)))

    # E2E latency → request duration
    for m in _RE_SG_E2E_SUM.finditer(text):
        dur_sum += float(m.group(1))

    # TTFT → time per token (rough proxy)
    for m in _RE_SG_TTFT_SUM.finditer(text):
        tpt_sum += float(m.group(1))
    for m in _RE_SG_TTFT_COUNT.finditer(text):
        tpt_count += int(float(m.group(1)))

    return {
        "generated_tokens": gen,
        "prompt_tokens": prompt,
        "request_count": req_count,
        "request_duration_sum": dur_sum,
        "tpt_sum": tpt_sum,
        "tpt_count": tpt_count,
    }


def _collect_sglang():
    """Scrape SGLang /metrics and record a snapshot."""
    try:
        resp = http_requests.get(_SGLANG_METRICS_URL, timeout=3)
        if resp.status_code != 200:
            return
        data = _parse_sglang_metrics(resp.text)
        if data is None:
            return
        model_name = f"[sglang] {_get_sglang_model_name()}"
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


# ---------------------------------------------------------------------------
# Combined collector (called from background loop)
# ---------------------------------------------------------------------------

def collect_token_metrics():
    """Scrape Ollama and SGLang metrics and record snapshots."""
    _collect_ollama()
    _collect_sglang()


@tokens_bp.route("/api/tokens/stats", methods=["GET"])
def token_stats():
    """Return token usage statistics for the requested window."""
    hours = request.args.get("hours", 24, type=int)
    hours = min(max(hours, 1), 168)  # clamp 1h–7d
    stats = storage.get_token_stats(hours)
    return jsonify(stats)
