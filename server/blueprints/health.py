"""Health check blueprint."""

import logging
import os
import socket
from datetime import datetime

from flask import Blueprint, jsonify

log = logging.getLogger(__name__)

from config import VERSION, cfg, cfg_bool, cfg_int

health_bp = Blueprint("health", __name__)


def _db_status() -> dict:
    """Check SQLite persistence status."""
    db_path = os.path.join(cfg("DATA_DIR"), "accelera.db")
    exists = os.path.isfile(db_path)
    size_bytes = os.path.getsize(db_path) if exists else 0
    row_counts = {}
    if exists:
        try:
            import sqlite3
            conn = sqlite3.connect(db_path, timeout=2)
            _ALLOWED_TABLES = ("gpu_history", "hosts", "alert_rules", "alert_events", "workload_events")
            for table in _ALLOWED_TABLES:
                try:
                    count = conn.execute(
                        "SELECT COUNT(*) FROM " + table
                    ).fetchone()[0]
                    row_counts[table] = count
                except Exception:
                    row_counts[table] = -1
            conn.close()
        except Exception:
            log.debug("Failed to read DB status", exc_info=True)
    return {
        "enabled": True,
        "path": db_path,
        "exists": exists,
        "size_bytes": size_bytes,
        "tables": row_counts,
    }


@health_bp.route("/health", methods=["GET"])
def health_simple():
    """Lightweight health probe for Docker / load-balancer checks."""
    return jsonify({"status": "ok"})


@health_bp.route("/api/health", methods=["GET"])
def health():
    """Health check endpoint with full system status."""
    return jsonify({
        "status": "ok",
        "platform": "Accelera",
        "version": VERSION,
        "hostname": socket.gethostname(),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "persistence": _db_status(),
        "features": {
            "gpu_events": True,
            "alerts": True,
            "prometheus": cfg_bool("PROMETHEUS_ENABLED"),
            "sse_streaming": True,
            "heatmap": True,
            "topology": True,
            "ollama": True,
            "sglang": True,
            "timeline": True,
        },
        "config": {
            "gpu_collect_interval": cfg_int("GPU_COLLECT_INTERVAL"),
            "data_retention_hours": cfg_int("HISTORICAL_DATA_RETENTION"),
        },
    })
