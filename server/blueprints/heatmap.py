"""Heatmap blueprint – historical GPU data for 3D heatmap visualisation."""

import socket
import time
from datetime import datetime

from flask import Blueprint, jsonify, request

import storage
from blueprints.gpu import get_gpus
from config import GPU_COLLECT_INTERVAL

heatmap_bp = Blueprint("heatmap", __name__)


def collect_historical_data():
    """Collect a single snapshot of GPU metrics and persist it."""
    try:
        gpus = get_gpus()
        timestamp = datetime.utcnow().strftime("%H:%M")
        hostname = socket.gethostname()

        with storage.data_lock:
            for i, gpu in enumerate(gpus):
                key = f"{hostname}:gpu-{i}"

                for metric in ("utilization", "temperature", "power", "memory"):
                    metric_key = f"{key}:{metric}"
                    if metric_key not in storage.historical_data:
                        storage.historical_data[metric_key] = storage.deque(maxlen=1440)

                val_util = gpu["utilization"]
                val_temp = gpu["temperature"]
                val_power = gpu["power"]["draw"]
                val_mem = (gpu["memory"]["used"] / gpu["memory"]["total"]) * 100 if gpu["memory"]["total"] else 0

                storage.historical_data[f"{key}:utilization"].append({"timestamp": timestamp, "value": val_util})
                storage.historical_data[f"{key}:temperature"].append({"timestamp": timestamp, "value": val_temp})
                storage.historical_data[f"{key}:power"].append({"timestamp": timestamp, "value": val_power})
                storage.historical_data[f"{key}:memory"].append({"timestamp": timestamp, "value": val_mem})

                # Persist to SQLite
                storage.persist_gpu_sample(hostname, key, "utilization", val_util, timestamp)
                storage.persist_gpu_sample(hostname, key, "temperature", val_temp, timestamp)
                storage.persist_gpu_sample(hostname, key, "power", val_power, timestamp)
                storage.persist_gpu_sample(hostname, key, "memory", val_mem, timestamp)

    except Exception as e:
        print(f"Error collecting historical data: {e}")


@heatmap_bp.route("/api/heatmap", methods=["GET"])
def get_heatmap_data():
    """Get historical data for 3D heatmap."""
    try:
        metric = request.args.get("metric", "utilization")
        hours = int(request.args.get("hours", 2))

        # Try SQLite first (persistent)
        db_data = storage.load_history_from_db(metric, hours)

        if db_data:
            # Build from SQLite data
            hosts_set = set()
            timestamps_set = set()
            for gpu_key, samples in db_data.items():
                hosts_set.add(gpu_key.split(":")[0])
                for s in samples:
                    timestamps_set.add(s["timestamp"])

            hosts = sorted(hosts_set)
            timestamps = sorted(timestamps_set)
            if len(timestamps) > hours * 60:
                timestamps = timestamps[-(hours * 60):]

            metrics_matrix = []
            for host in hosts:
                host_data = []
                for ts in timestamps:
                    value = 0
                    for gpu_id in range(16):
                        key = f"{host}:gpu-{gpu_id}"
                        if key in db_data:
                            for entry in db_data[key]:
                                if entry["timestamp"] == ts:
                                    value = max(value, entry["value"])
                                    break
                    host_data.append(value)
                metrics_matrix.append(host_data)
        else:
            # Fallback: in-memory
            hosts_set = set()
            timestamps_set = set()

            with storage.data_lock:
                for key in storage.historical_data.keys():
                    if f":{metric}" in key:
                        host_gpu = key.replace(f":{metric}", "")
                        hosts_set.add(host_gpu.split(":")[0])
                        for entry in storage.historical_data[key]:
                            timestamps_set.add(entry["timestamp"])

            hosts = sorted(hosts_set)
            timestamps = sorted(timestamps_set)
            if len(timestamps) > hours * 60:
                timestamps = timestamps[-(hours * 60):]

            metrics_matrix = []
            for host in hosts:
                host_data = []
                for ts in timestamps:
                    value = 0
                    for gpu_id in range(16):
                        key = f"{host}:gpu-{gpu_id}:{metric}"
                        if key in storage.historical_data:
                            for entry in storage.historical_data[key]:
                                if entry["timestamp"] == ts:
                                    value = max(value, entry["value"])
                                    break
                    host_data.append(value)
                metrics_matrix.append(host_data)

        # Demo data if nothing collected yet
        if not metrics_matrix:
            hosts = ["server-1", "server-2", "server-3", "server-4"]
            timestamps = [f"{i:02d}:00" for i in range(24)]
            metrics_matrix = []
            for _ in hosts:
                row = []
                base = 70 if metric == "utilization" else 65 if metric == "temperature" else 350 if metric == "power" else 60
                var = 40 if metric == "utilization" else 20 if metric == "temperature" else 100 if metric == "power" else 30
                for _ in timestamps:
                    row.append(base + (time.time() % 100) * var / 100 - var / 2)
                metrics_matrix.append(row)

        return jsonify({
            "hosts": hosts,
            "timestamps": timestamps,
            "metrics": {metric: metrics_matrix},
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500
