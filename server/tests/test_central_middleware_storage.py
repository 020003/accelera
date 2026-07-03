import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CENTRAL = ROOT / "central"


def _load_storage(data_dir: str):
    sys.modules.pop("central_storage_under_test", None)
    config = types.ModuleType("config")
    config.DATA_DIR = data_dir
    config.cfg = lambda key: ""
    sys.modules["config"] = config
    spec = importlib.util.spec_from_file_location("central_storage_under_test", CENTRAL / "storage.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["central_storage_under_test"] = module
    spec.loader.exec_module(module)
    return module


def _load_middleware(storage_module):
    sys.modules.pop("central_middleware_under_test", None)
    flask = types.ModuleType("flask")
    flask.Flask = object
    flask.jsonify = lambda value=None, *args, **kwargs: value
    flask.request = types.SimpleNamespace(path="/", method="GET", headers={}, remote_addr="127.0.0.1")
    sys.modules["flask"] = flask
    sys.modules["storage"] = storage_module
    spec = importlib.util.spec_from_file_location("central_middleware_under_test", CENTRAL / "middleware.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["central_middleware_under_test"] = module
    spec.loader.exec_module(module)
    return module


class CentralMiddlewareStorageTests(unittest.TestCase):
    def test_rate_limit_is_persisted_in_sqlite(self):
        with tempfile.TemporaryDirectory() as data_dir:
            storage = _load_storage(data_dir)
            storage.init_db()

            self.assertFalse(storage.is_rate_limited("10.0.0.1", limit=2, window_seconds=60, stale_after_seconds=300))
            self.assertFalse(storage.is_rate_limited("10.0.0.1", limit=2, window_seconds=60, stale_after_seconds=300))
            self.assertTrue(storage.is_rate_limited("10.0.0.1", limit=2, window_seconds=60, stale_after_seconds=300))

            row = storage._get_db().execute("SELECT count FROM rate_buckets WHERE ip = ?", ("10.0.0.1",)).fetchone()
            self.assertEqual(row["count"], 3)

    def test_login_lockout_is_persisted_and_clearable(self):
        with tempfile.TemporaryDirectory() as data_dir:
            storage = _load_storage(data_dir)
            storage.init_db()

            storage.record_login_failure("10.0.0.2", max_failures=2, lockout_base=30, lockout_max=900)
            self.assertEqual(storage.get_login_lockout("10.0.0.2", stale_after_seconds=600), (False, 0))

            storage.record_login_failure("10.0.0.2", max_failures=2, lockout_base=30, lockout_max=900)
            locked, remaining = storage.get_login_lockout("10.0.0.2", stale_after_seconds=600)
            self.assertTrue(locked)
            self.assertGreater(remaining, 0)

            storage.clear_login_failures("10.0.0.2")
            self.assertEqual(storage.get_login_lockout("10.0.0.2", stale_after_seconds=600), (False, 0))

    def test_middleware_helpers_delegate_to_storage(self):
        with tempfile.TemporaryDirectory() as data_dir:
            storage = _load_storage(data_dir)
            storage.init_db()
            middleware = _load_middleware(storage)

            for _ in range(middleware._MAX_FAILURES):
                middleware.record_login_failure("10.0.0.3")
            locked, remaining = middleware.is_login_locked("10.0.0.3")

            self.assertTrue(locked)
            self.assertGreater(remaining, 0)
            middleware.clear_login_failures("10.0.0.3")
            self.assertEqual(middleware.is_login_locked("10.0.0.3"), (False, 0))


if __name__ == "__main__":
    unittest.main()
