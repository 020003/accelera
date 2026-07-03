import argparse
import concurrent.futures
import json
import random
import statistics
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class WorkItem:
    name: str
    prompt: str
    weight: int
    max_tokens: int | None = None
    runtime: str | None = None
    model: str | None = None


@dataclass(frozen=True)
class RunResult:
    ok: bool
    status_code: int | None
    latency_ms: float
    workload: str
    runtime: str
    model: str
    tokens_per_second: float
    generated_tokens: int
    time_to_first_token_ms: float | None
    error: str | None


DEFAULT_WORKLOAD = [
    WorkItem(
        "short_chat",
        "In two sentences, explain why GPU memory bandwidth matters for LLM inference.",
        30,
        64,
    ),
    WorkItem(
        "technical_explain",
        "Explain tensor parallelism to an ML engineer who understands CUDA but is new to distributed inference.",
        20,
        128,
    ),
    WorkItem(
        "summarize",
        "Summarize this incident update for an executive audience: GPU utilization dropped after a polling refactor, runtime probes were coupled to telemetry refresh, and cache TTLs were split to restore freshness.",
        15,
        96,
    ),
    WorkItem(
        "code_help",
        "Write a Python function that computes p50, p95, and p99 latency from a list of millisecond measurements.",
        15,
        160,
    ),
    WorkItem(
        "json_extraction",
        "Return JSON with keys risk, root_cause, next_action for this issue: benchmark requests time out under mixed concurrent load.",
        10,
        96,
    ),
    WorkItem(
        "long_reasoning",
        "Compare throughput, latency, and fairness tradeoffs when serving a mix of short chat prompts and long code-generation prompts on the same LLM server.",
        10,
        256,
    ),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Send mixed concurrent benchmark requests to an Accelera GPU exporter.")
    parser.add_argument("--target", required=True, help="Exporter base URL, for example http://10.0.0.14:5000")
    parser.add_argument("--runtime", default="vllm", choices=("ollama", "sglang", "vllm"))
    parser.add_argument("--model", required=True)
    parser.add_argument("--requests", type=int, default=6)
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=180)
    parser.add_argument("--max-tokens", type=int, default=None)
    parser.add_argument("--token", default=None, help="Optional exporter bearer token")
    parser.add_argument("--workload-file", default=None, help="Optional JSONL file with name, prompt, weight, max_tokens, runtime, model")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON summary")
    return parser.parse_args()


def load_workload(path: str | None) -> list[WorkItem]:
    if not path:
        return DEFAULT_WORKLOAD
    items = []
    with open(path, "r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            data = json.loads(stripped)
            prompt = str(data.get("prompt", "")).strip()
            if not prompt:
                raise ValueError(f"workload line {line_number} is missing prompt")
            items.append(WorkItem(
                name=str(data.get("name") or f"line_{line_number}"),
                prompt=prompt,
                weight=int(data.get("weight", 1)),
                max_tokens=data.get("max_tokens"),
                runtime=data.get("runtime"),
                model=data.get("model"),
            ))
    if not items:
        raise ValueError("workload file did not contain any prompts")
    return items


def choose_items(workload: list[WorkItem], count: int, seed: int) -> list[WorkItem]:
    rng = random.Random(seed)
    weights = [max(1, item.weight) for item in workload]
    return rng.choices(workload, weights=weights, k=count)


def post_json(url: str, payload: dict[str, Any], timeout: float, token: str | None) -> tuple[int, dict[str, Any]]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            data = {"error": body[:500]}
        return exc.code, data


def run_one(target: str, default_runtime: str, default_model: str, item: WorkItem, timeout: float, max_tokens: int | None, token: str | None) -> RunResult:
    runtime = item.runtime or default_runtime
    model = item.model or default_model
    requested_tokens = max_tokens or item.max_tokens or 128
    payload = {
        "runtime": runtime,
        "model": model,
        "prompt": item.prompt,
        "max_tokens": requested_tokens,
    }
    started = time.perf_counter()
    try:
        status_code, data = post_json(f"{target.rstrip('/')}/api/benchmarks/run", payload, timeout, token)
        latency_ms = (time.perf_counter() - started) * 1000
        ok = status_code == 200 and data.get("status") == "completed"
        return RunResult(
            ok=ok,
            status_code=status_code,
            latency_ms=latency_ms,
            workload=item.name,
            runtime=runtime,
            model=model,
            tokens_per_second=float(data.get("tokens_per_second") or 0),
            generated_tokens=int(data.get("generated_tokens") or 0),
            time_to_first_token_ms=data.get("time_to_first_token_ms"),
            error=data.get("error") if not ok else None,
        )
    except Exception as exc:
        latency_ms = (time.perf_counter() - started) * 1000
        return RunResult(False, None, latency_ms, item.name, runtime, model, 0, 0, None, str(exc))


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((pct / 100) * (len(ordered) - 1))))
    return ordered[index]


def summarize(results: list[RunResult], elapsed_ms: float) -> dict[str, Any]:
    latencies = [result.latency_ms for result in results]
    successful = [result for result in results if result.ok]
    ttfts = [float(result.time_to_first_token_ms) for result in successful if result.time_to_first_token_ms is not None]
    tps = [result.tokens_per_second for result in successful if result.tokens_per_second > 0]
    by_workload: dict[str, dict[str, Any]] = {}
    for result in results:
        bucket = by_workload.setdefault(result.workload, {"count": 0, "ok": 0, "errors": 0})
        bucket["count"] += 1
        bucket["ok"] += 1 if result.ok else 0
        bucket["errors"] += 0 if result.ok else 1
    return {
        "requests": len(results),
        "successful": len(successful),
        "failed": len(results) - len(successful),
        "elapsed_ms": round(elapsed_ms, 1),
        "requests_per_second": round(len(results) / (elapsed_ms / 1000), 3) if elapsed_ms > 0 else 0,
        "latency_ms": {
            "min": round(min(latencies), 1) if latencies else 0,
            "mean": round(statistics.mean(latencies), 1) if latencies else 0,
            "p50": round(percentile(latencies, 50), 1),
            "p95": round(percentile(latencies, 95), 1),
            "p99": round(percentile(latencies, 99), 1),
            "max": round(max(latencies), 1) if latencies else 0,
        },
        "ttft_ms": {
            "mean": round(statistics.mean(ttfts), 1) if ttfts else None,
            "p95": round(percentile(ttfts, 95), 1) if ttfts else None,
        },
        "tokens_per_second": {
            "mean": round(statistics.mean(tps), 2) if tps else 0,
            "p50": round(percentile(tps, 50), 2) if tps else 0,
        },
        "by_workload": by_workload,
        "errors": [
            {
                "status_code": result.status_code,
                "workload": result.workload,
                "runtime": result.runtime,
                "model": result.model,
                "error": result.error,
            }
            for result in results
            if not result.ok
        ][:10],
    }


def print_summary(summary: dict[str, Any]) -> None:
    print(f"requests={summary['requests']} successful={summary['successful']} failed={summary['failed']} elapsed_ms={summary['elapsed_ms']}")
    print(f"rps={summary['requests_per_second']} latency_ms={summary['latency_ms']}")
    print(f"ttft_ms={summary['ttft_ms']} tokens_per_second={summary['tokens_per_second']}")
    print("workload_mix:")
    for name, stats in sorted(summary["by_workload"].items()):
        print(f"  {name}: count={stats['count']} ok={stats['ok']} errors={stats['errors']}")
    if summary["errors"]:
        print("errors:")
        for error in summary["errors"]:
            print(f"  status={error['status_code']} workload={error['workload']} runtime={error['runtime']} model={error['model']} error={error['error']}")


def main() -> int:
    args = parse_args()
    if args.requests < 1:
        raise SystemExit("--requests must be >= 1")
    if args.concurrency < 1:
        raise SystemExit("--concurrency must be >= 1")
    workload = load_workload(args.workload_file)
    items = choose_items(workload, args.requests, args.seed)
    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = [
            executor.submit(run_one, args.target, args.runtime, args.model, item, args.timeout, args.max_tokens, args.token)
            for item in items
        ]
        results = [future.result() for future in concurrent.futures.as_completed(futures)]
    elapsed_ms = (time.perf_counter() - started) * 1000
    summary = summarize(results, elapsed_ms)
    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print_summary(summary)
    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
