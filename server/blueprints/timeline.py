"""AI workload timeline blueprint."""

import random
import socket
import time
from datetime import datetime

from flask import Blueprint, jsonify, request

import storage

timeline_bp = Blueprint("timeline", __name__)


def simulate_workload_event(event_type: str, model_name: str, status: str):
    """Create a workload event (real or simulated)."""
    try:
        hostname = socket.gethostname()
        event = {
            "id": f"event-{int(time.time() * 1000)}",
            "content": f"{model_name} - {event_type}",
            "start": datetime.utcnow().isoformat(),
            "end": None if status == "running" else datetime.utcnow().isoformat(),
            "type": event_type,
            "host": hostname,
            "gpu": f"GPU-{len(storage.workload_events) % 4}",
            "model": model_name,
            "status": status,
            "metadata": {
                "tokensPerSecond": 45.2 if event_type == "inference" else 0,
                "requestCount": len(storage.workload_events) + 1,
                "memoryUsage": 12000 + (len(storage.workload_events) % 8) * 1000,
                "duration": 120 if status != "running" else 0,
            },
        }
        with storage.data_lock:
            storage.workload_events.append(event)
    except Exception as e:
        print(f"Error creating workload event: {e}")


@timeline_bp.route("/api/timeline", methods=["GET"])
def get_timeline_data():
    """Get AI workload timeline data."""
    try:
        host_filter = request.args.get("host", None)

        with storage.data_lock:
            events = list(storage.workload_events)

        if host_filter and host_filter != "all":
            events = [e for e in events if e["host"] == host_filter]

        hosts = list(set(e["host"] for e in events)) if events else [socket.gethostname()]

        # Generate demo data if no real events
        if not events:
            models = ["llama3.1:8b", "qwen2.5:32b", "deepseek-r1:14b", "llama3.3:70b"]
            event_types = ["model-load", "inference", "gpu-allocation", "training"]
            statuses = ["running", "completed", "failed", "queued"]

            for i in range(20):
                start_time = datetime.utcnow().timestamp() - random.randint(0, 7200)
                duration = random.randint(60, 1800)

                events.append({
                    "id": f"demo-event-{i}",
                    "content": f"{random.choice(models)} - {random.choice(event_types)}",
                    "start": datetime.fromtimestamp(start_time).isoformat(),
                    "end": datetime.fromtimestamp(start_time + duration).isoformat(),
                    "type": random.choice(event_types),
                    "host": socket.gethostname(),
                    "gpu": f"GPU-{random.randint(0, 3)}",
                    "model": random.choice(models),
                    "status": random.choice(statuses),
                    "metadata": {
                        "tokensPerSecond": random.uniform(20, 100),
                        "requestCount": random.randint(1, 1000),
                        "memoryUsage": random.randint(8000, 20000),
                        "duration": duration,
                    },
                })

        return jsonify({"events": events, "hosts": hosts})

    except Exception as e:
        return jsonify({"error": str(e)}), 500
