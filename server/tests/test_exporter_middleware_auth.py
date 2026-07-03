import importlib.util
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_middleware():
    sys.modules.pop("exporter_middleware_under_test", None)
    config = types.ModuleType("config")
    config.cfg = lambda key: ""
    sys.modules["config"] = config
    flask = types.ModuleType("flask")
    flask.Flask = object
    flask.jsonify = lambda value=None, *args, **kwargs: value
    flask.request = types.SimpleNamespace(path="/nvidia-smi.json", headers={}, remote_addr="127.0.0.1")
    sys.modules["flask"] = flask
    spec = importlib.util.spec_from_file_location("exporter_middleware_under_test", ROOT / "middleware.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["exporter_middleware_under_test"] = module
    spec.loader.exec_module(module)
    return module


class ExporterMiddlewareAuthTests(unittest.TestCase):
    def test_exporter_auth_allows_requests_when_unconfigured(self):
        middleware = _load_middleware()
        self.assertTrue(middleware._authorized_exporter_request())

    def test_exporter_auth_requires_matching_bearer_token(self):
        middleware = _load_middleware()
        middleware.cfg = lambda key: "secret-token" if key == "EXPORTER_AUTH_TOKEN" else ""

        middleware.request.headers = {}
        self.assertFalse(middleware._authorized_exporter_request())

        middleware.request.headers = {"Authorization": "Bearer wrong"}
        self.assertFalse(middleware._authorized_exporter_request())

        middleware.request.headers = {"Authorization": "Bearer secret-token"}
        self.assertTrue(middleware._authorized_exporter_request())


if __name__ == "__main__":
    unittest.main()
