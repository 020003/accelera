"""Token usage statistics – scrapes Ollama & SGLang Prometheus metrics.

Periodically reads ``/metrics`` from Ollama and SGLang instances,
storing cumulative counter snapshots in SQLite.  The API endpoint
returns delta-based stats for a configurable window.

Configuration (all optional, set in environment or docker-compose):

  ``OLLAMA_METRICS_URL``
      Full URL to an Ollama Prometheus metrics endpoint, e.g.
      ``http://host.docker.internal:11434/metrics``.  Use this when
      metrics are served by a separate sidecar (like *ollama-metrics*).
      Falls back to ``OLLAMA_URL`` + ``/metrics`` if unset.

  ``OLLAMA_URL``
      Ollama API base URL.  Used for ``/metrics`` fallback and model
      listing.  Also accepts legacy ``OLLAMA_HOST``.

  ``SGLANG_URL``
      SGLang base URL.  Used for ``/metrics`` and ``/get_server_info``
      fallback when Prometheus metrics are unavailable.

Endpoints:
  GET /api/tokens/stats?hours=24  — aggregated token statistics
"""

import logging
import os
import re

import requests as http_requests
from flask import Blueprint, jsonify, request

import storage
from config import (OLLAMA_URL, OLLAMA_METRICS_URL, SGLANG_URL, SGLANG_DEFAULT_PORT,
                    VLLM_URL, VLLM_DEFAULT_PORT)

log = logging.getLogger(__name__)
tokens_bp = Blueprint("tokens", __name__)


def _is_in_container() -> bool:
    """Best-effort check if we're running inside a Docker container."""
    try:
        with open("/proc/1/cgroup", "r") as f:
            return "docker" in f.read() or "containerd" in f.read()
    except Exception:
        pass
    return os.path.isfile("/.dockerenv")


def _resolve_ollama_metrics_url() -> str:
    """Determine the Ollama Prometheus metrics URL."""
    if OLLAMA_METRICS_URL:
        return OLLAMA_METRICS_URL.rstrip("/")
    if OLLAMA_URL:
        return f"{OLLAMA_URL.rstrip('/')}/metrics"
    host = "host.docker.internal" if _is_in_container() else "localhost"
    return f"http://{host}:11434/metrics"


def _resolve_sglang_base_url() -> str:
    """Determine the SGLang base URL."""
    if SGLANG_URL:
        return SGLANG_URL.rstrip("/")
    host = "host.docker.internal" if _is_in_container() else "localhost"
    return f"http://{host}:{SGLANG_DEFAULT_PORT}"


def _resolve_vllm_base_url() -> str:
    """Determine the vLLM base URL."""
    if VLLM_URL:
        return VLLM_URL.rstrip("/")
    host = "host.docker.internal" if _is_in_container() else "localhost"
    return f"http://{host}:{VLLM_DEFAULT_PORT}"


_ollama_metrics_url = _resolve_ollama_metrics_url()
_sglang_base_url = _resolve_sglang_base_url()
_vllm_base_url = _resolve_vllm_base_url()

# ---------------------------------------------------------------------------
# Ollama metrics
# ---------------------------------------------------------------------------

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
        resp = http_requests.get(_ollama_metrics_url, timeout=3)
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
        log.debug("Ollama token collection failed", exc_info=True)


# ---------------------------------------------------------------------------
# SGLang metrics
# ---------------------------------------------------------------------------

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
            f"{_sglang_base_url}/v1/models", timeout=2
        )
        if resp.status_code == 200:
            data = resp.json()
            models = data.get("data", [])
            if models:
                return models[0].get("id", "sglang-model")
    except Exception:
        log.debug("Failed to fetch SGLang model name", exc_info=True)
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


def _collect_sglang_via_server_info() -> bool:
    """Fallback: extract throughput from ``/get_server_info`` when ``/metrics`` is unavailable.

    SGLang exposes ``last_gen_throughput`` (tokens/s) inside
    ``internal_states[0]``.  We record a synthetic snapshot so
    the frontend at least shows live throughput.
    Returns True if data was recorded.
    """
    try:
        resp = http_requests.get(f"{_sglang_base_url}/get_server_info", timeout=3)
        if resp.status_code != 200:
            return False
        info = resp.json()

        # Extract throughput from internal_states
        throughput = 0.0
        internal = info.get("internal_states", [])
        if isinstance(internal, list) and internal:
            throughput = internal[0].get("last_gen_throughput", 0.0)
        elif isinstance(info, dict):
            throughput = info.get("last_gen_throughput", 0.0)

        if not throughput:
            return False

        model_name = f"[sglang] {_get_sglang_model_name()}"
        # Record a synthetic snapshot: throughput goes into tpt fields
        # so the stats aggregator can compute TPS.
        storage.record_token_snapshot(
            model=model_name,
            prompt_tokens=0,
            generated_tokens=int(throughput),  # cumulative-like: current TPS
            request_count=0,
            tpt_sum=1.0 / throughput if throughput > 0 else 0.0,
            tpt_count=1,
            req_dur_sum=0.0,
        )
        return True
    except Exception:
        return False


def _collect_sglang():
    """Scrape SGLang /metrics and record a snapshot.

    Falls back to ``/get_server_info`` if ``/metrics`` is not available
    (SGLang needs ``--enable-metrics`` to expose Prometheus metrics).
    """
    try:
        resp = http_requests.get(f"{_sglang_base_url}/metrics", timeout=3)
        if resp.status_code == 200:
            data = _parse_sglang_metrics(resp.text)
            if data is not None:
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
                return
    except Exception:
        log.debug("SGLang /metrics collection failed", exc_info=True)

    # Fallback: /get_server_info for throughput
    _collect_sglang_via_server_info()


# ---------------------------------------------------------------------------
# Combined collector (called from background loop)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# vLLM metrics
# ---------------------------------------------------------------------------

_RE_VLLM_GEN = re.compile(
    r'^vllm:generation_tokens_total(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_VLLM_PROMPT = re.compile(
    r'^vllm:prompt_tokens_total(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_VLLM_REQUESTS = re.compile(
    r'^vllm:(?:num_requests_total|request_success_total)(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_VLLM_E2E_SUM = re.compile(
    r'^vllm:e2e_request_latency_seconds_sum(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_VLLM_TTFT_SUM = re.compile(
    r'^vllm:time_to_first_token_seconds_sum(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_VLLM_TTFT_COUNT = re.compile(
    r'^vllm:time_to_first_token_seconds_count(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
# Fallback patterns (older vLLM versions use underscores instead of colons)
_RE_VLLM_GEN_ALT = re.compile(
    r'^vllm_generation_tokens_total(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_VLLM_PROMPT_ALT = re.compile(
    r'^vllm_prompt_tokens_total(?:\{[^}]*\})?\s+([\d.]+)', re.M
)
_RE_VLLM_REQUESTS_ALT = re.compile(
    r'^vllm_(?:num_requests_total|request_success_total)(?:\{[^}]*\})?\s+([\d.]+)', re.M
)


def _get_vllm_model_name() -> str:
    """Best-effort fetch of the model name from vLLM /v1/models."""
    try:
        resp = http_requests.get(f"{_vllm_base_url}/v1/models", timeout=2)
        if resp.status_code == 200:
            data = resp.json()
            models = data.get("data", [])
            if models:
                return models[0].get("id", "vllm-model")
    except Exception:
        log.debug("Failed to fetch vLLM model name", exc_info=True)
    return "vllm-model"


def _parse_vllm_metrics(text: str) -> dict | None:
    """Parse vLLM Prometheus metrics into a single model dict."""
    gen = 0
    prompt = 0
    req_count = 0
    dur_sum = 0.0
    tpt_sum = 0.0
    tpt_count = 0

    for m in _RE_VLLM_GEN.finditer(text):
        gen += int(float(m.group(1)))
    if gen == 0:
        for m in _RE_VLLM_GEN_ALT.finditer(text):
            gen += int(float(m.group(1)))

    for m in _RE_VLLM_PROMPT.finditer(text):
        prompt += int(float(m.group(1)))
    if prompt == 0:
        for m in _RE_VLLM_PROMPT_ALT.finditer(text):
            prompt += int(float(m.group(1)))

    if gen == 0 and prompt == 0:
        return None

    for m in _RE_VLLM_REQUESTS.finditer(text):
        req_count += int(float(m.group(1)))
    if req_count == 0:
        for m in _RE_VLLM_REQUESTS_ALT.finditer(text):
            req_count += int(float(m.group(1)))

    for m in _RE_VLLM_E2E_SUM.finditer(text):
        dur_sum += float(m.group(1))

    for m in _RE_VLLM_TTFT_SUM.finditer(text):
        tpt_sum += float(m.group(1))
    for m in _RE_VLLM_TTFT_COUNT.finditer(text):
        tpt_count += int(float(m.group(1)))

    return {
        "generated_tokens": gen,
        "prompt_tokens": prompt,
        "request_count": req_count,
        "request_duration_sum": dur_sum,
        "tpt_sum": tpt_sum,
        "tpt_count": tpt_count,
    }


def _collect_vllm():
    """Scrape vLLM /metrics and record a snapshot."""
    try:
        resp = http_requests.get(f"{_vllm_base_url}/metrics", timeout=3)
        if resp.status_code == 200:
            data = _parse_vllm_metrics(resp.text)
            if data is not None:
                model_name = f"[vllm] {_get_vllm_model_name()}"
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
        log.debug("vLLM /metrics collection failed", exc_info=True)


def collect_token_metrics():
    """Scrape Ollama, SGLang, and vLLM metrics and record snapshots."""
    _collect_ollama()
    _collect_sglang()
    _collect_vllm()


@tokens_bp.route("/api/tokens/stats", methods=["GET"])
def token_stats():
    """Return token usage statistics for the requested window."""
    hours = request.args.get("hours", 24, type=int)
    hours = min(max(hours, 1), 168)  # clamp 1h–7d
    stats = storage.get_token_stats(hours)
    return jsonify(stats)
