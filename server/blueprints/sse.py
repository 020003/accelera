"""Server-Sent Events (SSE) blueprint for real-time GPU metric streaming.

Endpoints:
  GET /api/stream/gpu   — SSE stream of GPU metrics (one JSON event per interval)
  GET /api/stream/alerts — SSE stream of new alert events
"""

import json
import time
import threading
from datetime import datetime

from flask import Blueprint, Response, request

from config import GPU_COLLECT_INTERVAL
from blueprints.gpu import get_gpus
import storage

sse_bp = Blueprint("sse", __name__)

# ---------------------------------------------------------------------------
# Shared event bus (simple in-process pub/sub)
# ---------------------------------------------------------------------------

_subscribers_lock = threading.Lock()
_gpu_subscribers: list = []
_alert_subscribers: list = []


class _SSEClient:
    """Thin wrapper around a queue so each subscriber gets its own copy."""

    def __init__(self):
        import queue
        self.q: "queue.Queue[str | None]" = queue.Queue(maxsize=64)

    def put(self, data: str):
        try:
            self.q.put_nowait(data)
        except Exception:
            pass  # drop if buffer full

    def stream(self):
        while True:
            msg = self.q.get()
            if msg is None:
                break
            yield msg


def _publish_gpu(event_data: str):
    with _subscribers_lock:
        dead = []
        for client in _gpu_subscribers:
            try:
                client.put(event_data)
            except Exception:
                dead.append(client)
        for d in dead:
            _gpu_subscribers.remove(d)


def _publish_alert(event_data: str):
    with _subscribers_lock:
        dead = []
        for client in _alert_subscribers:
            try:
                client.put(event_data)
            except Exception:
                dead.append(client)
        for d in dead:
            _alert_subscribers.remove(d)


def publish_alert_event(alert_dict: dict):
    """Called from alerts blueprint when a new alert fires."""
    formatted = _format_sse(json.dumps(alert_dict), event="alert")
    _publish_alert(formatted)


# ---------------------------------------------------------------------------
# Background publisher thread
# ---------------------------------------------------------------------------

def _gpu_publisher():
    """Periodically fetches GPU data and pushes to all SSE subscribers."""
    import socket
    while True:
        try:
            gpus = get_gpus()
            payload = {
                "host": socket.gethostname(),
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "gpus": gpus,
            }
            formatted = _format_sse(json.dumps(payload), event="gpu")
            _publish_gpu(formatted)
        except Exception as e:
            err = _format_sse(json.dumps({"error": str(e)}), event="error")
            _publish_gpu(err)
        time.sleep(GPU_COLLECT_INTERVAL)


_publisher_started = False
_publisher_lock = threading.Lock()


def _ensure_publisher():
    global _publisher_started
    with _publisher_lock:
        if not _publisher_started:
            t = threading.Thread(target=_gpu_publisher, daemon=True)
            t.start()
            _publisher_started = True


# ---------------------------------------------------------------------------
# SSE formatting
# ---------------------------------------------------------------------------

def _format_sse(data: str, event: str | None = None) -> str:
    lines = []
    if event:
        lines.append(f"event: {event}")
    for line in data.splitlines():
        lines.append(f"data: {line}")
    lines.append("")
    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@sse_bp.route("/api/stream/gpu")
def stream_gpu():
    """SSE endpoint — streams GPU metrics to the client."""
    _ensure_publisher()

    client = _SSEClient()
    with _subscribers_lock:
        _gpu_subscribers.append(client)

    def generate():
        try:
            yield _format_sse("connected", event="status")
            for msg in client.stream():
                yield msg
        finally:
            with _subscribers_lock:
                if client in _gpu_subscribers:
                    _gpu_subscribers.remove(client)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@sse_bp.route("/api/stream/alerts")
def stream_alerts():
    """SSE endpoint — streams new alert events to the client."""
    client = _SSEClient()
    with _subscribers_lock:
        _alert_subscribers.append(client)

    def generate():
        try:
            yield _format_sse("connected", event="status")
            for msg in client.stream():
                yield msg
        finally:
            with _subscribers_lock:
                if client in _alert_subscribers:
                    _alert_subscribers.remove(client)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
