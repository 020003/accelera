"""AI Model Benchmark Runner blueprint.

Sends standardized prompts to Ollama or SGLang, measures throughput and
latency, and persists results in SQLite for historical comparison.
"""

import json
import logging
import time

import requests as http_requests
from flask import Blueprint, jsonify, request

import storage
from blueprints.ollama import check_ollama_availability
from blueprints.sglang import check_sglang_availability
from blueprints.vllm import check_vllm_availability

log = logging.getLogger(__name__)
benchmarks_bp = Blueprint("benchmarks", __name__)

# ---------------------------------------------------------------------------
# Preset benchmark prompts (short / medium / long)
# ---------------------------------------------------------------------------

PRESETS: dict[str, dict] = {
    "short": {
        "prompt": "Explain what a GPU is in exactly three sentences.",
        "max_tokens": 100,
        "label": "Short (3 sentences)",
    },
    "medium": {
        "prompt": (
            "Write a detailed comparison of NVIDIA A100 and H100 GPUs, "
            "covering architecture, memory bandwidth, tensor core improvements, "
            "power efficiency, and best use-cases for each."
        ),
        "max_tokens": 512,
        "label": "Medium (technical comparison)",
    },
    "long": {
        "prompt": (
            "You are a senior ML engineer. Write a comprehensive guide on "
            "how to optimize inference throughput for large language models "
            "on multi-GPU systems. Cover batching strategies, KV-cache management, "
            "tensor parallelism vs pipeline parallelism, quantization trade-offs, "
            "and monitoring best practices. Include concrete examples."
        ),
        "max_tokens": 1024,
        "label": "Long (optimization guide)",
    },
}


def _benchmark_ollama(ollama_url: str, model: str, prompt: str, max_tokens: int) -> dict:
    """Run a single benchmark against an Ollama /api/generate endpoint."""
    t0 = time.perf_counter()
    ttft = None
    generated_tokens = 0
    full_response = []

    try:
        resp = http_requests.post(
            f"{ollama_url}/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": True,
                "options": {"num_predict": max_tokens},
            },
            stream=True,
            timeout=120,
        )
        resp.raise_for_status()

        for line in resp.iter_lines():
            if not line:
                continue
            chunk = json.loads(line)
            if ttft is None and chunk.get("response"):
                ttft = (time.perf_counter() - t0) * 1000  # ms

            if chunk.get("response"):
                full_response.append(chunk["response"])
                generated_tokens += 1

            if chunk.get("done"):
                # Ollama provides its own metrics in the final chunk
                eval_count = chunk.get("eval_count", generated_tokens)
                eval_duration_ns = chunk.get("eval_duration", 0)
                prompt_eval_count = chunk.get("prompt_eval_count", 0)
                total_duration_ns = chunk.get("total_duration", 0)

                total_ms = total_duration_ns / 1e6 if total_duration_ns else (time.perf_counter() - t0) * 1000
                tps = (eval_count / (eval_duration_ns / 1e9)) if eval_duration_ns > 0 else 0

                return {
                    "model": model,
                    "runtime": "ollama",
                    "prompt": prompt[:200],
                    "prompt_tokens": prompt_eval_count,
                    "generated_tokens": eval_count,
                    "tokens_per_second": round(tps, 2),
                    "time_to_first_token_ms": round(ttft, 1) if ttft else None,
                    "total_duration_ms": round(total_ms, 1),
                    "status": "completed",
                    "metadata": {
                        "max_tokens": max_tokens,
                        "response_preview": "".join(full_response)[:300],
                    },
                }

        # Stream ended without a done=true chunk
        total_ms = (time.perf_counter() - t0) * 1000
        tps = generated_tokens / (total_ms / 1000) if total_ms > 0 else 0
        return {
            "model": model,
            "runtime": "ollama",
            "prompt": prompt[:200],
            "prompt_tokens": 0,
            "generated_tokens": generated_tokens,
            "tokens_per_second": round(tps, 2),
            "time_to_first_token_ms": round(ttft, 1) if ttft else None,
            "total_duration_ms": round(total_ms, 1),
            "status": "completed",
            "metadata": {"max_tokens": max_tokens, "response_preview": "".join(full_response)[:300]},
        }

    except Exception as exc:
        total_ms = (time.perf_counter() - t0) * 1000
        return {
            "model": model,
            "runtime": "ollama",
            "prompt": prompt[:200],
            "prompt_tokens": 0,
            "generated_tokens": 0,
            "tokens_per_second": 0,
            "time_to_first_token_ms": None,
            "total_duration_ms": round(total_ms, 1),
            "status": "error",
            "error": str(exc),
            "metadata": {"max_tokens": max_tokens},
        }


def _benchmark_openai_compat(base_url: str, model: str, prompt: str, max_tokens: int, runtime: str) -> dict:
    """Run a single benchmark against an OpenAI-compatible /v1/completions endpoint.

    Works for both SGLang and vLLM.
    """
    t0 = time.perf_counter()

    try:
        resp = http_requests.post(
            f"{base_url}/v1/completions",
            json={
                "model": model,
                "prompt": prompt,
                "max_tokens": max_tokens,
                "stream": False,
            },
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()

        total_ms = (time.perf_counter() - t0) * 1000
        usage = data.get("usage", {})
        gen_tokens = usage.get("completion_tokens", 0)
        prompt_tokens = usage.get("prompt_tokens", 0)
        tps = gen_tokens / (total_ms / 1000) if total_ms > 0 and gen_tokens > 0 else 0

        response_text = ""
        choices = data.get("choices", [])
        if choices:
            response_text = choices[0].get("text", "")

        return {
            "model": model,
            "runtime": runtime,
            "prompt": prompt[:200],
            "prompt_tokens": prompt_tokens,
            "generated_tokens": gen_tokens,
            "tokens_per_second": round(tps, 2),
            "time_to_first_token_ms": None,
            "total_duration_ms": round(total_ms, 1),
            "status": "completed",
            "metadata": {"max_tokens": max_tokens, "response_preview": response_text[:300]},
        }

    except Exception as exc:
        total_ms = (time.perf_counter() - t0) * 1000
        return {
            "model": model,
            "runtime": runtime,
            "prompt": prompt[:200],
            "prompt_tokens": 0,
            "generated_tokens": 0,
            "tokens_per_second": 0,
            "time_to_first_token_ms": None,
            "total_duration_ms": round(total_ms, 1),
            "status": "error",
            "error": str(exc),
            "metadata": {"max_tokens": max_tokens},
        }


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@benchmarks_bp.route("/api/benchmarks/presets", methods=["GET"])
def list_presets():
    """Return available benchmark presets."""
    return jsonify({k: {"label": v["label"], "max_tokens": v["max_tokens"]} for k, v in PRESETS.items()})


@benchmarks_bp.route("/api/benchmarks/run", methods=["POST"])
def run_benchmark():
    """Run a benchmark against a model.

    Body JSON:
        model: str          — model name (e.g. "llama3.2:3b")
        runtime: "ollama" | "sglang"
        preset: str         — one of "short", "medium", "long"  (optional if prompt given)
        prompt: str         — custom prompt (optional, overrides preset)
        max_tokens: int     — max tokens to generate (optional, default from preset)
    """
    body = request.get_json()
    if not body:
        return jsonify({"error": "Missing JSON body"}), 400

    model = body.get("model")
    runtime = body.get("runtime", "ollama")
    preset_key = body.get("preset", "short")

    if not model:
        return jsonify({"error": "Missing 'model' field"}), 400
    if runtime not in ("ollama", "sglang", "vllm"):
        return jsonify({"error": "runtime must be 'ollama', 'sglang', or 'vllm'"}), 400

    preset = PRESETS.get(preset_key, PRESETS["short"])
    prompt = body.get("prompt", preset["prompt"])
    max_tokens = body.get("max_tokens", preset["max_tokens"])

    if runtime == "ollama":
        # Discover Ollama URL
        ollama_info = check_ollama_availability("http://localhost:5000")
        ollama_url = ollama_info.get("ollamaUrl")
        if not ollama_url:
            return jsonify({"error": "Ollama is not available on this host"}), 503

        log.info("Running Ollama benchmark: model=%s, preset=%s", model, preset_key)
        result = _benchmark_ollama(ollama_url, model, prompt, max_tokens)
    elif runtime == "sglang":
        sglang_info = check_sglang_availability("http://localhost:5000")
        sglang_url = sglang_info.get("sglangUrl")
        if not sglang_url:
            return jsonify({"error": "SGLang is not available on this host"}), 503

        log.info("Running SGLang benchmark: model=%s, preset=%s", model, preset_key)
        result = _benchmark_openai_compat(sglang_url, model, prompt, max_tokens, "sglang")
    else:
        vllm_info = check_vllm_availability("http://localhost:5000")
        vllm_url = vllm_info.get("vllmUrl")
        if not vllm_url:
            return jsonify({"error": "vLLM is not available on this host"}), 503

        log.info("Running vLLM benchmark: model=%s, preset=%s", model, preset_key)
        result = _benchmark_openai_compat(vllm_url, model, prompt, max_tokens, "vllm")

    # Persist
    result_id = storage.save_benchmark_result(result)
    result["id"] = result_id

    status_code = 200 if result["status"] == "completed" else 500
    return jsonify(result), status_code


@benchmarks_bp.route("/api/benchmarks/results", methods=["GET"])
def list_results():
    """Return stored benchmark results. Optional ?model=xxx filter."""
    model = request.args.get("model")
    limit = request.args.get("limit", 50, type=int)
    limit = min(max(limit, 1), 200)
    results = storage.get_benchmark_results(model=model, limit=limit)
    return jsonify(results)
