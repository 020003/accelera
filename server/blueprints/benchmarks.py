"""AI Model Benchmark Runner blueprint.

Sends standardized prompts to Ollama, SGLang, or vLLM, measures throughput
and latency, and persists results in SQLite for historical comparison.
"""

import concurrent.futures
import json
import logging
import random
import statistics
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


def _openai_compat_payload(model: str, prompt: str, max_tokens: int, chat: bool) -> dict:
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    if chat:
        payload["messages"] = [{"role": "user", "content": prompt}]
    else:
        payload["prompt"] = prompt
    return payload


def _stream_chunk_text(data: dict) -> str:
    choices = data.get("choices") or []
    if not choices:
        return ""
    choice = choices[0]
    if choice.get("text"):
        return choice["text"]
    return (choice.get("delta") or choice.get("message") or {}).get("content") or ""


def _consume_openai_stream(resp, started_at: float) -> tuple[str, dict, float | None, float | None]:
    text = []
    usage = {}
    first_token_at = None
    last_token_at = None
    for raw_line in resp.iter_lines():
        if not raw_line:
            continue
        line = raw_line.decode("utf-8", errors="replace") if isinstance(raw_line, bytes) else raw_line
        if not line.startswith("data:"):
            continue
        line = line[5:].strip()
        if not line or line == "[DONE]":
            continue
        data = json.loads(line)
        if data.get("usage"):
            usage = data["usage"]
        chunk_text = _stream_chunk_text(data)
        if chunk_text:
            now = time.perf_counter()
            first_token_at = first_token_at or now
            last_token_at = now
            text.append(chunk_text)
    ttft_ms = (first_token_at - started_at) * 1000 if first_token_at else None
    generation_ms = (last_token_at - first_token_at) * 1000 if first_token_at and last_token_at else None
    return "".join(text), usage, ttft_ms, generation_ms


def _count_runtime_tokens(base_url: str, model: str, text: str) -> int:
    if not text:
        return 0
    try:
        resp = http_requests.post(
            f"{base_url}/tokenize",
            json={"model": model, "prompt": text},
            timeout=10,
        )
        if resp.status_code != 200:
            return 0
        data = resp.json()
        if data.get("count") is not None:
            return int(data["count"])
        return len(data.get("tokens") or data.get("token_ids") or [])
    except Exception:
        return 0


def _post_openai_stream(url: str, payload: dict):
    resp = http_requests.post(url, json=payload, stream=True, timeout=120)
    if resp.status_code == 400 and "stream_options" in payload:
        compatible_payload = dict(payload)
        compatible_payload.pop("stream_options")
        resp = http_requests.post(url, json=compatible_payload, stream=True, timeout=120)
    return resp


def _benchmark_openai_compat(base_url: str, model: str, prompt: str, max_tokens: int, runtime: str) -> dict:
    t0 = time.perf_counter()
    try:
        endpoint = "completions"
        resp = _post_openai_stream(
            f"{base_url}/v1/completions",
            _openai_compat_payload(model, prompt, max_tokens, chat=False),
        )
        if resp.status_code in (404, 405):
            endpoint = "chat/completions"
            resp = _post_openai_stream(
                f"{base_url}/v1/chat/completions",
                _openai_compat_payload(model, prompt, max_tokens, chat=True),
            )
        resp.raise_for_status()
        response_text, usage, ttft_ms, generation_ms = _consume_openai_stream(resp, t0)
        total_ms = (time.perf_counter() - t0) * 1000
        gen_tokens = int(usage.get("completion_tokens") or 0)
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        token_count_source = "runtime_usage"
        if not usage:
            gen_tokens = _count_runtime_tokens(base_url, model, response_text)
            prompt_tokens = _count_runtime_tokens(base_url, model, prompt)
            token_count_source = "tokenize_endpoint" if gen_tokens or prompt_tokens else "unavailable"
        generation_seconds = generation_ms / 1000 if generation_ms and generation_ms > 0 else total_ms / 1000
        timed_generation_tokens = gen_tokens - 1 if gen_tokens > 1 and generation_ms else gen_tokens
        output_tps = timed_generation_tokens / generation_seconds if timed_generation_tokens > 0 and generation_seconds > 0 else 0
        e2e_tps = gen_tokens / (total_ms / 1000) if gen_tokens > 0 and total_ms > 0 else 0
        return {
            "model": model,
            "runtime": runtime,
            "prompt": prompt[:200],
            "prompt_tokens": prompt_tokens,
            "generated_tokens": gen_tokens,
            "tokens_per_second": round(output_tps, 2),
            "time_to_first_token_ms": round(ttft_ms, 1) if ttft_ms is not None else None,
            "total_duration_ms": round(total_ms, 1),
            "status": "completed",
            "metadata": {
                "max_tokens": max_tokens,
                "response_preview": response_text[:300],
                "endpoint": endpoint,
                "generation_duration_ms": round(generation_ms, 1) if generation_ms is not None else None,
                "end_to_end_tokens_per_second": round(e2e_tps, 2),
                "token_count_source": token_count_source,
            },
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


def _resolve_runtime(runtime: str) -> str | None:
    checks = {
        "ollama": (check_ollama_availability, "ollamaUrl"),
        "sglang": (check_sglang_availability, "sglangUrl"),
        "vllm": (check_vllm_availability, "vllmUrl"),
    }
    check, key = checks[runtime]
    return check("http://localhost:5000").get(key)


def _run_at_url(runtime_url: str, runtime: str, model: str, prompt: str, max_tokens: int) -> dict:
    if runtime == "ollama":
        return _benchmark_ollama(runtime_url, model, prompt, max_tokens)
    return _benchmark_openai_compat(runtime_url, model, prompt, max_tokens, runtime)


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(percentile / 100 * (len(ordered) - 1))))
    return ordered[index]


def _distribution(values: list[float]) -> dict:
    return {
        "min": round(min(values), 2) if values else 0,
        "mean": round(statistics.mean(values), 2) if values else 0,
        "p50": round(_percentile(values, 50), 2),
        "p95": round(_percentile(values, 95), 2),
        "p99": round(_percentile(values, 99), 2),
        "max": round(max(values), 2) if values else 0,
    }


def _summarize_load(results: list[dict], elapsed_ms: float) -> dict:
    successful = [result for result in results if result["status"] == "completed"]
    latencies = [result["total_duration_ms"] for result in results]
    ttfts = [result["time_to_first_token_ms"] for result in successful if result.get("time_to_first_token_ms") is not None]
    output_rates = [result["tokens_per_second"] for result in successful if result["tokens_per_second"] > 0]
    prompt_tokens = sum(result["prompt_tokens"] for result in successful)
    generated_tokens = sum(result["generated_tokens"] for result in successful)
    by_workload: dict[str, dict] = {}
    for result in results:
        workload = result.get("workload", "default")
        item = by_workload.setdefault(workload, {"count": 0, "successful": 0, "failed": 0})
        item["count"] += 1
        item["successful"] += result["status"] == "completed"
        item["failed"] += result["status"] != "completed"
    elapsed_seconds = elapsed_ms / 1000
    return {
        "requests": len(results),
        "successful": len(successful),
        "failed": len(results) - len(successful),
        "elapsed_ms": round(elapsed_ms, 1),
        "requests_per_second": round(len(successful) / elapsed_seconds, 3) if elapsed_seconds > 0 else 0,
        "output_tokens_per_second": round(generated_tokens / elapsed_seconds, 2) if elapsed_seconds > 0 else 0,
        "total_tokens_per_second": round((prompt_tokens + generated_tokens) / elapsed_seconds, 2) if elapsed_seconds > 0 else 0,
        "prompt_tokens": prompt_tokens,
        "generated_tokens": generated_tokens,
        "latency_ms": _distribution(latencies),
        "ttft_ms": _distribution(ttfts),
        "per_request_output_tokens_per_second": _distribution(output_rates),
        "by_workload": by_workload,
        "errors": [
            {"workload": result.get("workload"), "error": result.get("error", "Benchmark failed")}
            for result in results if result["status"] != "completed"
        ][:10],
    }


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
    prompt = str(body.get("prompt", preset["prompt"])).strip()
    try:
        max_tokens = int(body.get("max_tokens", preset["max_tokens"]))
    except (TypeError, ValueError):
        return jsonify({"error": "max_tokens must be an integer"}), 400
    if not prompt or len(prompt) > 50_000:
        return jsonify({"error": "prompt must contain 1 to 50000 characters"}), 400
    if max_tokens < 1 or max_tokens > 4096:
        return jsonify({"error": "max_tokens must be between 1 and 4096"}), 400

    runtime_url = _resolve_runtime(runtime)
    if not runtime_url:
        return jsonify({"error": f"{runtime} is not available on this host"}), 503
    log.info("Running %s benchmark: model=%s, preset=%s", runtime, model, preset_key)
    result = _run_at_url(runtime_url, runtime, model, prompt, max_tokens)

    result_id = storage.save_benchmark_result(result)
    result["id"] = result_id

    status_code = 200 if result["status"] == "completed" else 500
    return jsonify(result), status_code


@benchmarks_bp.route("/api/benchmarks/load", methods=["POST"])
def run_load_benchmark():
    body = request.get_json() or {}
    runtime = body.get("runtime", "vllm")
    model = str(body.get("model") or "").strip()
    if runtime not in ("ollama", "sglang", "vllm") or not model:
        return jsonify({"error": "A valid runtime and model are required"}), 400
    try:
        request_count = int(body.get("requests", 32))
        concurrency = int(body.get("concurrency", 8))
        seed = int(body.get("seed", 7))
        global_max_tokens = int(body.get("max_tokens", 512))
    except (TypeError, ValueError):
        return jsonify({"error": "requests, concurrency, seed, and max_tokens must be integers"}), 400
    if not 1 <= request_count <= 500 or not 1 <= concurrency <= 64 or not 1 <= global_max_tokens <= 4096:
        return jsonify({"error": "Bounds: requests 1-500, concurrency 1-64, max_tokens 1-4096"}), 400

    raw_workloads = body.get("workloads") or [{"name": "short", **PRESETS["short"], "weight": 1}]
    workloads = []
    for index, item in enumerate(raw_workloads):
        if not isinstance(item, dict):
            return jsonify({"error": f"workload {index + 1} must be an object"}), 400
        prompt = str(item.get("prompt") or "").strip()
        if not prompt or len(prompt) > 50_000:
            return jsonify({"error": f"workload {index + 1} has an invalid prompt"}), 400
        try:
            weight = max(1, int(item.get("weight", 1)))
            max_tokens = min(global_max_tokens, int(item.get("max_tokens", global_max_tokens)))
        except (TypeError, ValueError):
            return jsonify({"error": f"workload {index + 1} has invalid numeric values"}), 400
        if max_tokens < 1:
            return jsonify({"error": f"workload {index + 1} max_tokens must be positive"}), 400
        workloads.append({"name": str(item.get("name") or f"workload_{index + 1}")[:80], "prompt": prompt, "weight": weight, "max_tokens": max_tokens})
    if len(workloads) > 100:
        return jsonify({"error": "At most 100 workloads are allowed"}), 400

    runtime_url = _resolve_runtime(runtime)
    if not runtime_url:
        return jsonify({"error": f"{runtime} is not available on this host"}), 503
    rng = random.Random(seed)
    selected = rng.choices(workloads, weights=[item["weight"] for item in workloads], k=request_count)
    started_at = time.perf_counter()

    def execute(item: dict) -> dict:
        result = _run_at_url(runtime_url, runtime, model, item["prompt"], item["max_tokens"])
        result["workload"] = item["name"]
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=min(concurrency, request_count)) as executor:
        results = list(executor.map(execute, selected))
    elapsed_ms = (time.perf_counter() - started_at) * 1000
    for result in results:
        storage.save_benchmark_result(result)
    return jsonify({
        "runtime": runtime,
        "model": model,
        "concurrency": concurrency,
        "summary": _summarize_load(results, elapsed_ms),
    })


@benchmarks_bp.route("/api/benchmarks/results", methods=["GET"])
def list_results():
    """Return stored benchmark results. Optional ?model=xxx filter."""
    model = request.args.get("model")
    limit = request.args.get("limit", 50, type=int)
    limit = min(max(limit, 1), 200)
    results = storage.get_benchmark_results(model=model, limit=limit)
    return jsonify(results)
