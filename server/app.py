"""Accelera GPU Monitoring Platform – Flask application entry point.

All route logic lives in blueprints/ modules.  This file only wires them
together, sets up CORS, and starts background tasks.
"""

import threading
import time

from flask import Flask
from flask_cors import CORS

from config import CORS_ORIGINS, FLASK_DEBUG, FLASK_HOST, FLASK_PORT, FLASK_SECRET_KEY, GPU_COLLECT_INTERVAL
import storage

# -------------------------------------------------------------------
# App factory
# -------------------------------------------------------------------

app = Flask(__name__)
app.secret_key = FLASK_SECRET_KEY

# CORS
if CORS_ORIGINS == "*":
    CORS(app, origins="*")
else:
    CORS(app, origins=CORS_ORIGINS.split(","))

# Initialise persistent storage (creates tables if needed)
storage.init_db()

# Load runtime config overrides from SQLite
from config import load_runtime_overrides
load_runtime_overrides(storage.get_all_config())

# -------------------------------------------------------------------
# Register blueprints
# -------------------------------------------------------------------
from blueprints.gpu import gpu_bp
from blueprints.hosts import hosts_bp
from blueprints.ollama import ollama_bp
from blueprints.topology import topology_bp
from blueprints.health import health_bp
from blueprints.heatmap import heatmap_bp
from blueprints.timeline import timeline_bp
from blueprints.prometheus import prometheus_bp
from blueprints.alerts import alerts_bp
from blueprints.events import events_bp
from blueprints.sse import sse_bp
from blueprints.settings import settings_bp
from blueprints.tokens import tokens_bp
from blueprints.sglang import sglang_bp

for bp in (gpu_bp, hosts_bp, ollama_bp, sglang_bp, topology_bp, health_bp,
           heatmap_bp, timeline_bp, prometheus_bp, alerts_bp, events_bp,
           sse_bp, settings_bp, tokens_bp):
    app.register_blueprint(bp)

# -------------------------------------------------------------------
# Background tasks
# -------------------------------------------------------------------

from blueprints.heatmap import collect_historical_data
from blueprints.alerts import evaluate_alerts
from blueprints.timeline import simulate_workload_event
from blueprints.tokens import collect_token_metrics


def _background_loop():
    """Periodic background work: collect metrics, evaluate alerts, prune old data."""
    cycle = 0
    while True:
        collect_historical_data()
        evaluate_alerts()
        collect_token_metrics()
        cycle += 1
        # Prune old history every 60 cycles (~1 hour at 60s interval)
        if cycle % 60 == 0:
            storage.prune_old_history()
            storage.prune_old_token_snapshots()
        time.sleep(GPU_COLLECT_INTERVAL)


def _start_background_tasks():
    thread = threading.Thread(target=_background_loop, daemon=True)
    thread.start()


_start_background_tasks()


# Seed a few demo workload events on startup
def _create_demo_events():
    models = ["llama3.1:8b", "qwen2.5:32b", "deepseek-r1:14b"]
    for i, model in enumerate(models):
        simulate_workload_event("model-load", model, "completed")
        time.sleep(0.1)
        simulate_workload_event("inference", model, "running" if i == 0 else "completed")


threading.Timer(2.0, _create_demo_events).start()

# -------------------------------------------------------------------
# Entry point
# -------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host=FLASK_HOST, port=FLASK_PORT, debug=FLASK_DEBUG)
