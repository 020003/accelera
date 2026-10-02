import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def _load_fabric():
    sys.modules.pop("fabric_under_test", None)
    flask = types.ModuleType("flask")

    class Blueprint:
        def __init__(self, *args, **kwargs):
            pass

        def route(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator

    flask.Blueprint = Blueprint
    flask.jsonify = lambda value: value
    sys.modules["flask"] = flask
    spec = importlib.util.spec_from_file_location("fabric_under_test", ROOT / "blueprints" / "fabric.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["fabric_under_test"] = module
    spec.loader.exec_module(module)
    return module


class FabricRdmaMetricTests(unittest.TestCase):
    def test_roce_poller_exposes_total_and_rdma_bytes(self):
        fabric = _load_fabric()
        with patch.object(fabric, "_poller_snapshot", return_value={
            "ports": {
                "mlx5_0": {
                    "iface": "ens1f0np0",
                    "tx_bytes": 1000,
                    "rx_bytes": 2000,
                    "tx_rdma_bytes": 600,
                    "rx_rdma_bytes": 1500,
                }
            }
        }):
            sample = fabric._roce_bytes_from_poller("mlx5_0")
        self.assertEqual(sample, (1000, 2000, 600, 1500, "ens1f0np0"))

    def test_rate_warms_up_then_reports_counter_delta(self):
        fabric = _load_fabric()
        self.assertEqual(fabric._rate("rdma", 100, 10.0), 0.0)
        self.assertEqual(fabric._rate("rdma", 160, 12.0), 30.0)

    def test_indexed_values_filters_zero_entries_and_orders_indices(self):
        fabric = _load_fabric()
        values = {
            "/gids/2": "fe80::2",
            "/gids/0": "0000:0000:0000:0000:0000:0000:0000:0000",
            "/gids/1": "fe80::1",
            "/pkeys/0": "0xffff",
            "/pkeys/1": "0x0000",
        }
        with patch.object(fabric.os, "listdir", side_effect=lambda path: ["2", "0", "1"] if path == "/gids" else ["1", "0"]), patch.object(fabric, "_read_str", side_effect=lambda path: values.get(path, "")):
            self.assertEqual(fabric._read_indexed_values("/gids"), ["fe80::1", "fe80::2"])
            self.assertEqual(fabric._read_indexed_values("/pkeys"), ["0xffff"])


if __name__ == "__main__":
    unittest.main()
