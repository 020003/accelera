import importlib.util
import sys
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
    sys.modules["config"] = config

    utils = types.ModuleType("utils")
    utils.run_cmd = lambda *args, **kwargs: ""
    utils.is_valid_host_url = lambda url: True
    sys.modules["utils"] = utils

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


if __name__ == "__main__":
    unittest.main()
