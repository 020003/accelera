import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


CENTRAL = Path(__file__).resolve().parents[1] / "central"


def _load_policy():
    sys.modules.pop("host_policy_under_test", None)
    spec = importlib.util.spec_from_file_location("host_policy_under_test", CENTRAL / "host_policy.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["host_policy_under_test"] = module
    spec.loader.exec_module(module)
    return module


class CentralHostPolicyTests(unittest.TestCase):
    def test_accepts_only_approved_snapshot_endpoint(self):
        with patch.dict(os.environ, {"ALLOWED_EXPORTER_HOSTS": "10.0.0.11,10.0.0.12"}, clear=False):
            policy = _load_policy()
            validated = policy.validate_exporter_url(
                "http://10.0.0.11:5000/nvidia-smi.json",
                require_snapshot_path=True,
            )
        self.assertEqual(validated.value, "http://10.0.0.11:5000/nvidia-smi.json")

    def test_rejects_unapproved_hosts_and_non_exporter_urls(self):
        with patch.dict(os.environ, {"ALLOWED_EXPORTER_HOSTS": "10.0.0.11"}, clear=False):
            policy = _load_policy()
            for url in (
                "http://127.0.0.1:5000/nvidia-smi.json",
                "http://10.0.0.12:5000/nvidia-smi.json",
                "http://10.0.0.11:5001/nvidia-smi.json",
                "http://10.0.0.11:5000/internal",
                "http://10.0.0.11:5000/nvidia-smi.json?target=internal",
                "http://gpu.example:5000/nvidia-smi.json",
            ):
                with self.assertRaises(ValueError, msg=url):
                    policy.validate_exporter_url(url, require_snapshot_path=True)


if __name__ == "__main__":
    unittest.main()
