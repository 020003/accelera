import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
CENTRAL = ROOT / "central"


def _install_flask_stub():
    flask = types.ModuleType("flask")

    class Blueprint:
        def __init__(self, *args, **kwargs):
            pass

        def route(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator

    flask.Blueprint = Blueprint
    flask.jsonify = lambda value=None, *args, **kwargs: value
    sys.modules["flask"] = flask


def _load_storage(data_dir: str):
    sys.modules.pop("central_storage_for_fleet_test", None)
    config = types.ModuleType("config")
    config.DATA_DIR = data_dir
    sys.modules["config"] = config
    spec = importlib.util.spec_from_file_location("central_storage_for_fleet_test", CENTRAL / "storage.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["central_storage_for_fleet_test"] = module
    spec.loader.exec_module(module)
    return module


def _load_fleet(storage_module):
    sys.modules.pop("central_fleet_under_test", None)
    _install_flask_stub()
    auth = types.ModuleType("auth")
    auth.login_required = lambda fn: fn
    sys.modules["auth"] = auth
    sys.modules["storage"] = storage_module
    spec = importlib.util.spec_from_file_location("central_fleet_under_test", CENTRAL / "fleet.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["central_fleet_under_test"] = module
    spec.loader.exec_module(module)
    return module


class _Response:
    def __init__(self, status_code, data):
        self.status_code = status_code
        self._data = data

    def json(self):
        return self._data


class CentralFleetSnapshotTests(unittest.TestCase):
    def test_fetch_host_snapshot_returns_dashboard_shaped_data(self):
        with tempfile.TemporaryDirectory() as data_dir:
            storage = _load_storage(data_dir)
            storage.init_db()
            fleet = _load_fleet(storage)

            def fake_get(url, **kwargs):
                self.assertEqual(url, "http://gpu:5000/nvidia-smi.json")
                return _Response(200, {
                    "timestamp": "2026-07-02T00:00:00Z",
                    "gpus": [{"minor_number": 0, "product_name": "GPU"}],
                })

            def fake_post(url, json, **kwargs):
                if url.endswith("/api/ollama/discover"):
                    return _Response(200, {"isAvailable": False})
                if url.endswith("/api/sglang/discover"):
                    return _Response(200, {"isAvailable": False})
                if url.endswith("/api/vllm/discover"):
                    return _Response(200, {
                        "isAvailable": True,
                        "models": [{"id": "model-a"}],
                        "vllmUrl": "http://gpu:8000",
                        "version": "1.0",
                    })
                raise AssertionError(url)

            with patch.object(fleet.requests, "get", fake_get), patch.object(fleet.requests, "post", fake_post):
                result = fleet._fetch_host_snapshot({"url": "http://gpu:5000/nvidia-smi.json", "name": "GPU Host"})

            self.assertEqual(result["url"], "http://gpu:5000/nvidia-smi.json")
            self.assertEqual(result["name"], "GPU Host")
            self.assertTrue(result["isConnected"])
            self.assertEqual(result["gpus"], [{"minor_number": 0, "product_name": "GPU"}])
            self.assertEqual(result["timestamp"], "2026-07-02T00:00:00Z")
            self.assertTrue(result["vllm"]["isAvailable"])
            self.assertEqual(result["vllm"]["models"], [{"id": "model-a"}])
            self.assertEqual(result["snapshotSource"], "live")
            self.assertFalse(result["stale"])
            self.assertEqual(result["cacheAgeSeconds"], 0.0)
            self.assertIn("fetchedAt", result)
            self.assertIn("lastSuccessAt", result)
            self.assertIn("fetchDurationMs", result)

    def test_fetch_host_snapshot_handles_exporter_failure(self):
        with tempfile.TemporaryDirectory() as data_dir:
            storage = _load_storage(data_dir)
            storage.init_db()
            fleet = _load_fleet(storage)

            with patch.object(fleet.requests, "get", lambda *args, **kwargs: _Response(500, {})):
                result = fleet._fetch_host_snapshot({"url": "http://gpu:5000/nvidia-smi.json", "name": "GPU Host"})

            self.assertEqual(result["url"], "http://gpu:5000/nvidia-smi.json")
            self.assertEqual(result["name"], "GPU Host")
            self.assertFalse(result["isConnected"])
            self.assertEqual(result["gpus"], [])
            self.assertEqual(result["error"], "fetch_failed")
            self.assertEqual(result["snapshotSource"], "live")
            self.assertFalse(result["stale"])
            self.assertEqual(result["cacheAgeSeconds"], 0.0)
            self.assertIn("fetchedAt", result)
            self.assertIn("fetchDurationMs", result)

    def test_fetch_host_snapshot_uses_fresh_cache(self):
        with tempfile.TemporaryDirectory() as data_dir:
            storage = _load_storage(data_dir)
            storage.init_db()
            fleet = _load_fleet(storage)
            calls = {"get": 0}

            def fake_get(url, **kwargs):
                calls["get"] += 1
                return _Response(200, {"timestamp": "ts", "gpus": [{"minor_number": 0}]})

            def fake_post(url, json, **kwargs):
                return _Response(200, {"isAvailable": False})

            with patch.object(fleet.requests, "get", fake_get), patch.object(fleet.requests, "post", fake_post):
                first = fleet._fetch_host_snapshot({"url": "http://gpu:5000/nvidia-smi.json", "name": "GPU Host"})
                second = fleet._fetch_host_snapshot({"url": "http://gpu:5000/nvidia-smi.json", "name": "Renamed"})

            self.assertEqual(calls["get"], 1)
            self.assertEqual(first["snapshotSource"], "live")
            self.assertEqual(second["snapshotSource"], "cache")
            self.assertEqual(second["name"], "Renamed")
            self.assertTrue(second["isConnected"])
            self.assertFalse(second["stale"])

    def test_fetch_host_snapshot_returns_stale_cache_after_failure(self):
        with tempfile.TemporaryDirectory() as data_dir:
            storage = _load_storage(data_dir)
            storage.init_db()
            fleet = _load_fleet(storage)

            def fake_post(url, json, **kwargs):
                return _Response(200, {"isAvailable": False})

            with patch.object(fleet.requests, "get", lambda *args, **kwargs: _Response(200, {"timestamp": "ts", "gpus": [{"minor_number": 0}]})), patch.object(fleet.requests, "post", fake_post):
                first = fleet._fetch_host_snapshot({"url": "http://gpu:5000/nvidia-smi.json", "name": "GPU Host"})

            fleet._host_cache["http://gpu:5000/nvidia-smi.json"]["fetchedAt"] = first["fetchedAt"] - fleet.CACHE_TTL_SECONDS - 1
            with patch.object(fleet.requests, "get", lambda *args, **kwargs: _Response(500, {})):
                second = fleet._fetch_host_snapshot({"url": "http://gpu:5000/nvidia-smi.json", "name": "GPU Host"})

            self.assertFalse(second["isConnected"])
            self.assertEqual(second["snapshotSource"], "stale-cache")
            self.assertTrue(second["stale"])
            self.assertEqual(second["error"], "fetch_failed")
            self.assertEqual(second["gpus"], [{"minor_number": 0}])
            self.assertIn("lastSuccessAt", second)


if __name__ == "__main__":
    unittest.main()
