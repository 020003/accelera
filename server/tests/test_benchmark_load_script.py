import importlib.util
import pathlib
import unittest


SCRIPT_PATH = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "benchmark_load.py"
SPEC = importlib.util.spec_from_file_location("benchmark_load", SCRIPT_PATH)
benchmark_load = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(benchmark_load)


class BenchmarkLoadScriptTests(unittest.TestCase):
    def test_weighted_workload_selection_is_deterministic(self):
        workload = [
            benchmark_load.WorkItem("short", "a", 10, 32),
            benchmark_load.WorkItem("long", "b", 1, 128),
        ]

        first = benchmark_load.choose_items(workload, 5, seed=42)
        second = benchmark_load.choose_items(workload, 5, seed=42)

        self.assertEqual([item.name for item in first], [item.name for item in second])
        self.assertEqual(len(first), 5)

    def test_summary_reports_success_failure_and_percentiles(self):
        results = [
            benchmark_load.RunResult(True, 200, 100.0, "short", "vllm", "model", 50.0, 20, 25.0, None),
            benchmark_load.RunResult(True, 200, 200.0, "short", "vllm", "model", 40.0, 20, 35.0, None),
            benchmark_load.RunResult(False, 500, 500.0, "long", "vllm", "model", 0.0, 0, None, "boom"),
        ]

        summary = benchmark_load.summarize(results, elapsed_ms=1000.0)

        self.assertEqual(summary["requests"], 3)
        self.assertEqual(summary["successful"], 2)
        self.assertEqual(summary["failed"], 1)
        self.assertEqual(summary["latency_ms"]["p50"], 200.0)
        self.assertEqual(summary["by_workload"]["short"]["ok"], 2)
        self.assertEqual(summary["errors"][0]["error"], "boom")


if __name__ == "__main__":
    unittest.main()
