import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class _Blueprint:
    def __init__(self, *args, **kwargs):
        pass

    def route(self, *args, **kwargs):
        def decorator(func):
            return func
        return decorator


def _install_stubs():
    flask = types.ModuleType("flask")
    flask.Blueprint = _Blueprint
    flask.jsonify = lambda value=None, *args, **kwargs: value
    flask.request = types.SimpleNamespace(get_json=lambda: {})
    sys.modules["flask"] = flask

    requests = types.ModuleType("requests")
    requests.get = lambda *args, **kwargs: None
    requests.RequestException = Exception
    sys.modules["requests"] = requests

    config = types.ModuleType("config")
    config.cfg = lambda key: ""
    config.VLLM_URL = ""
    config.VLLM_DISCOVER_TIMEOUT = 3000
    config.VLLM_DEFAULT_PORT = 8000
    config.OLLAMA_URL = ""
    config.OLLAMA_METRICS_URL = ""
    config.SGLANG_URL = ""
    config.SGLANG_DEFAULT_PORT = 30000
    sys.modules["config"] = config

    utils = types.ModuleType("utils")
    utils.run_cmd = lambda *args, **kwargs: ""
    utils.is_valid_host_url = lambda url: True
    sys.modules["utils"] = utils

    storage = types.ModuleType("storage")
    storage.record_token_snapshot = lambda **kwargs: None
    storage.get_token_stats = lambda hours: {}
    sys.modules["storage"] = storage

    blueprints = types.ModuleType("blueprints")
    blueprints.__path__ = []
    sys.modules["blueprints"] = blueprints


def _load_module(name: str, relative_path: str):
    _install_stubs()
    spec = importlib.util.spec_from_file_location(name, ROOT / relative_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class VllmAttributionTests(unittest.TestCase):
    def test_gpu_enriches_vllm_workers_from_parent_commands(self):
        gpu = _load_module("gpu_under_test", "blueprints/gpu.py")
        cmdlines = {
            101: "VLLM::EngineCore",
            201: "VLLM::EngineCore",
            1001: "/usr/local/bin/vllm serve --model /hf/snapshots/abc --served-model-name qwen3.6-27b-fp8 Qwen/Qwen3.6-27B-FP8 --port 8000",
            2001: "/usr/local/bin/vllm serve --model Qwen/Qwen3.6-35B-A3B --served-model-name qwen3.6-35b-a3b-mtp --port 8001",
        }
        parents = {101: 1001, 201: 2001}
        gpu._read_cmdline = lambda pid: cmdlines.get(pid, "")
        gpu._read_parent_pid = lambda pid: parents.get(pid, 0)
        gpu._refresh_model_cache = lambda: None
        gpu._model_cache["vllm"] = ["wrong-global-model"]
        gpus = [
            {"processes": [{"pid": 101, "name": "VLLM::EngineCore", "memory": 1}]},
            {"processes": [{"pid": 201, "name": "VLLM::EngineCore", "memory": 1}]},
        ]

        gpu._enrich_processes(gpus)

        self.assertEqual(gpus[0]["processes"][0]["model"], "qwen3.6-27b-fp8, Qwen/Qwen3.6-27B-FP8")
        self.assertEqual(gpus[1]["processes"][0]["model"], "qwen3.6-35b-a3b-mtp")

    def test_process_inspector_matches_vllm_from_parent_command(self):
        gpu_stub = types.ModuleType("blueprints.gpu")
        gpu_stub.get_gpus = lambda: []
        sys.modules["blueprints.gpu"] = gpu_stub
        processes = _load_module("processes_under_test", "blueprints/processes.py")
        cmdlines = {
            9195: "VLLM::EngineCore",
            6286: "/usr/local/bin/vllm serve --model Qwen/Qwen3.6-35B-A3B --served-model-name qwen3.6-35b-a3b-mtp --port 8001",
        }
        processes._read_cmdline = lambda pid: cmdlines.get(pid, "")
        processes._read_parent_pid = lambda pid: 6286 if pid == 9195 else 0

        model = processes._match_model_to_process(
            {"pid": 9195, "runtime": "vLLM", "cmdline": "VLLM::EngineCore", "memory": 1},
            [],
            [],
            ["wrong-global-model"],
        )

        self.assertEqual(model, "qwen3.6-35b-a3b-mtp")

    def test_vllm_discovery_combines_primary_models_per_instance(self):
        vllm = _load_module("vllm_under_test", "blueprints/vllm.py")
        result = vllm._combine_results([
            {
                "vllmUrl": "http://host.docker.internal:8000",
                "version": "0.20.1",
                "models": [{"id": "qwen3.6-27b-fp8"}, {"id": "Qwen/Qwen3.6-27B-FP8"}],
            },
            {
                "vllmUrl": "http://10.0.0.14:8001",
                "version": "0.20.1",
                "models": [{"id": "qwen3.6-35b-a3b-mtp"}],
            },
        ])

        self.assertEqual(result["statistics"], {"totalModels": 2, "totalInstances": 2})
        self.assertEqual([m["id"] for m in result["models"]], ["qwen3.6-27b-fp8", "qwen3.6-35b-a3b-mtp"])
        self.assertEqual(result["instances"][0]["primaryModel"]["id"], "qwen3.6-27b-fp8")

    def test_vllm_metrics_preserve_model_labels_and_prefer_success_count(self):
        tokens = _load_module("tokens_under_test", "blueprints/tokens.py")
        text = """
vllm:generation_tokens_total{model_name="model-a"} 100
vllm:prompt_tokens_total{model_name="model-a"} 40
vllm:request_success_total{model_name="model-a",finished_reason="stop"} 5
vllm:request_success_total{model_name="model-a",finished_reason="length"} 2
vllm:num_requests_total{model_name="model-a"} 99
vllm:inter_token_latency_seconds_sum{model_name="model-a"} 2.5
vllm:inter_token_latency_seconds_count{model_name="model-a"} 50
vllm_generation_tokens_total{model_name="model-b"} 30
vllm_prompt_tokens_total{model_name="model-b"} 10
"""

        groups = tokens._vllm_metric_groups(text)
        aggregate = tokens._parse_vllm_metrics(text)

        self.assertEqual(set(groups), {"model-a", "model-b"})
        self.assertEqual(groups["model-b"]["generated_tokens"], 30)
        self.assertEqual(aggregate["generated_tokens"], 130)
        self.assertEqual(aggregate["request_count"], 7)
        self.assertEqual(aggregate["tpt_count"], 50)

    def test_token_stats_include_window_baseline_and_counter_resets(self):
        with tempfile.TemporaryDirectory() as directory:
            config = types.ModuleType("config")
            config.DATA_DIR = directory
            config.HISTORICAL_DATA_RETENTION = 168
            sys.modules["config"] = config
            spec = importlib.util.spec_from_file_location("storage_under_test", ROOT / "storage.py")
            storage = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(storage)
            storage.init_db()
            snapshots = [
                (6300, 40, 100, 4),
                (6500, 50, 130, 5),
                (7000, 2, 5, 1),
                (7100, 6, 15, 2),
            ]
            for timestamp, prompt, generated, requests in snapshots:
                storage.time.time = lambda value=timestamp: value
                storage.record_token_snapshot("model", prompt, generated, requests, 0, 0, requests)
            storage.time.time = lambda: 10000

            stats = storage.get_token_stats(1)

            self.assertEqual(stats["summary"]["total_generated"], 45)
            self.assertEqual(stats["summary"]["total_prompt"], 16)
            self.assertEqual(stats["summary"]["cumulative_generated"], 145)
            self.assertEqual(stats["summary"]["cumulative_prompt"], 56)
            self.assertEqual(stats["summary"]["total_requests"], 3)
            self.assertEqual(stats["models"]["model"]["avg_generated_tokens"], 15)
            storage._close_db()

    def test_vllm_status_exposes_scheduler_cache_and_prefix_metrics(self):
        tokens = _load_module("tokens_status_under_test", "blueprints/tokens.py")
        status = tokens._parse_vllm_status("""
vllm:num_requests_running{model_name="a"} 3
vllm:num_requests_waiting{model_name="a"} 4
vllm:num_requests_swapped{model_name="a"} 1
vllm:kv_cache_usage_perc{model_name="a"} 0.875
vllm:cpu_cache_usage_perc{model_name="a"} 0.25
vllm:prefix_cache_queries_total{model_name="a"} 200
vllm:prefix_cache_hits_total{model_name="a"} 150
vllm:num_preemptions_total{model_name="a"} 6
""")

        self.assertEqual(status["scheduler"], {"running": 3, "waiting": 4, "swapped": 1})
        self.assertEqual(status["cache"]["gpu_usage_pct"], 87.5)
        self.assertEqual(status["prefix_cache"]["hit_rate_pct"], 75.0)
        self.assertEqual(status["preemptions"], 6)


if __name__ == "__main__":
    unittest.main()
