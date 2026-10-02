import importlib.util
import json
import pathlib
import sys
import types
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[1]
BENCHMARKS_PATH = ROOT / "blueprints" / "benchmarks.py"


class _Response:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"{self.status_code} error")

    def json(self):
        return self._payload

    def iter_lines(self):
        yield f"data: {json.dumps(self._payload)}".encode()
        yield b"data: [DONE]"


class BenchmarkBlueprintTests(unittest.TestCase):
    def _load_benchmarks(self):
        flask = types.ModuleType("flask")
        flask.Blueprint = lambda *args, **kwargs: types.SimpleNamespace(route=lambda *route_args, **route_kwargs: lambda func: func)
        flask.jsonify = lambda value=None, **kwargs: value if value is not None else kwargs
        flask.request = types.SimpleNamespace(get_json=lambda: {})
        sys.modules["flask"] = flask

        storage = types.ModuleType("storage")
        storage.save_benchmark_result = lambda result: 1
        storage.get_benchmark_results = lambda model=None, limit=50: []
        sys.modules["storage"] = storage

        for name, func_name, url_key in (
            ("blueprints.ollama", "check_ollama_availability", "ollamaUrl"),
            ("blueprints.sglang", "check_sglang_availability", "sglangUrl"),
            ("blueprints.vllm", "check_vllm_availability", "vllmUrl"),
        ):
            module = types.ModuleType(name)
            setattr(module, func_name, lambda base_url, key=url_key: {key: "http://runtime:8000"})
            sys.modules[name] = module

        spec = importlib.util.spec_from_file_location("benchmarks_for_test", BENCHMARKS_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_openai_compat_uses_completions_when_available(self):
        benchmarks = self._load_benchmarks()
        calls = []

        def fake_post(url, json, **kwargs):
            calls.append((url, json))
            return _Response(200, {
                "choices": [{"text": "hello"}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 5},
            })

        with patch.object(benchmarks.http_requests, "post", fake_post):
            result = benchmarks._benchmark_openai_compat("http://runtime:8000", "model", "prompt", 32, "vllm")

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "http://runtime:8000/v1/completions")
        self.assertIn("prompt", calls[0][1])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["generated_tokens"], 5)
        self.assertEqual(result["metadata"]["endpoint"], "completions")
        self.assertEqual(result["metadata"]["response_preview"], "hello")
        self.assertEqual(result["metadata"]["token_count_source"], "runtime_usage")
        self.assertIsNotNone(result["time_to_first_token_ms"])
        self.assertTrue(calls[0][1]["stream"])
        self.assertEqual(calls[0][1]["stream_options"], {"include_usage": True})

    def test_openai_compat_falls_back_to_chat_completions_on_404(self):
        benchmarks = self._load_benchmarks()
        calls = []

        def fake_post(url, json, **kwargs):
            calls.append((url, json))
            if url.endswith("/v1/completions"):
                return _Response(404, {"error": "not found"})
            return _Response(200, {
                "choices": [{"message": {"content": "chat hello"}}],
                "usage": {"prompt_tokens": 4, "completion_tokens": 6},
            })

        with patch.object(benchmarks.http_requests, "post", fake_post):
            result = benchmarks._benchmark_openai_compat("http://runtime:8000", "model", "prompt", 32, "vllm")

        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][0], "http://runtime:8000/v1/chat/completions")
        self.assertIn("messages", calls[1][1])
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["generated_tokens"], 6)
        self.assertEqual(result["metadata"]["endpoint"], "chat/completions")
        self.assertEqual(result["metadata"]["response_preview"], "chat hello")
        self.assertIsNotNone(result["time_to_first_token_ms"])

    def test_load_summary_reports_aggregate_throughput_and_ttft(self):
        benchmarks = self._load_benchmarks()
        results = [
            {
                "status": "completed",
                "prompt_tokens": 10,
                "generated_tokens": 20,
                "tokens_per_second": 40,
                "time_to_first_token_ms": 25,
                "total_duration_ms": 500,
                "workload": "chat",
            },
            {
                "status": "error",
                "prompt_tokens": 0,
                "generated_tokens": 0,
                "tokens_per_second": 0,
                "time_to_first_token_ms": None,
                "total_duration_ms": 1000,
                "workload": "code",
                "error": "timeout",
            },
        ]

        summary = benchmarks._summarize_load(results, 2000)

        self.assertEqual(summary["successful"], 1)
        self.assertEqual(summary["output_tokens_per_second"], 10)
        self.assertEqual(summary["total_tokens_per_second"], 15)
        self.assertEqual(summary["ttft_ms"]["p95"], 25)
        self.assertEqual(summary["by_workload"]["code"]["failed"], 1)


if __name__ == "__main__":
    unittest.main()
