"""Accelera GPU Monitoring Platform – Flask application entry point.

All route logic lives in blueprints/ modules.  This file only wires them
together, sets up CORS, and starts background tasks.
"""

import logging
import signal
import sys
import threading
import time

from flask import Flask
from flask_cors import CORS

from config import CORS_ORIGINS, FLASK_DEBUG, FLASK_HOST, FLASK_PORT, FLASK_SECRET_KEY, GPU_COLLECT_INTERVAL, LOG_LEVEL, VERSION
import storage

# -------------------------------------------------------------------
# Logging
# -------------------------------------------------------------------

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("accelera")

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

# Inject version header on every response
@app.after_request
def _add_version_header(response):
    response.headers["X-Accelera-Version"] = VERSION
    return response

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
from blueprints.tokens import collect_token_metrics


_shutdown = threading.Event()


def _background_loop():
    """Periodic background work: collect metrics, evaluate alerts, prune old data."""
    cycle = 0
    log.info("Background loop started (interval=%ds)", GPU_COLLECT_INTERVAL)
    while not _shutdown.is_set():
        try:
            collect_historical_data()
        except Exception:
            log.exception("Error in collect_historical_data")
        try:
            evaluate_alerts()
        except Exception:
            log.exception("Error in evaluate_alerts")
        try:
            collect_token_metrics()
        except Exception:
            log.exception("Error in collect_token_metrics")
        cycle += 1
        # Prune old history every 60 cycles (~1 hour at 60s interval)
        if cycle % 60 == 0:
            try:
                storage.prune_old_history()
                storage.prune_old_token_snapshots()
            except Exception:
                log.exception("Error pruning old data")
        _shutdown.wait(GPU_COLLECT_INTERVAL)
    log.info("Background loop stopped")


def _start_background_tasks():
    thread = threading.Thread(target=_background_loop, daemon=True, name="bg-loop")
    thread.start()


def _handle_shutdown(signum, _frame):
    """Graceful shutdown on SIGTERM/SIGINT."""
    log.info("Received signal %s — shutting down", signal.Signals(signum).name)
    _shutdown.set()
    sys.exit(0)


signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

_start_background_tasks()
log.info("Accelera GPU exporter starting on %s:%s", FLASK_HOST, FLASK_PORT)

# -------------------------------------------------------------------
# Entry point
# -------------------------------------------------------------------

if __name__ == "__main__":
    app.run(host=FLASK_HOST, port=FLASK_PORT, debug=FLASK_DEBUG)
