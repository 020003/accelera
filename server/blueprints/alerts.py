"""Alerting blueprint – threshold-based alerts with webhook/email notifications."""

import json
import logging
import smtplib
import threading
import time
import uuid
from datetime import datetime
from email.mime.text import MIMEText

import requests as http_requests
from flask import Blueprint, jsonify, request

import storage
from config import (
    ALERT_EMAIL_FROM,
    ALERT_EMAIL_PASSWORD,
    ALERT_EMAIL_SMTP_HOST,
    ALERT_EMAIL_SMTP_PORT,
    ALERT_EMAIL_TO,
    ALERT_WEBHOOK_URL,
)
from blueprints.gpu import get_gpus

alerts_bp = Blueprint("alerts", __name__)

# Track last fire time per rule to enforce cooldown
_last_fired: dict[str, float] = {}
_fire_lock = threading.Lock()


# -------------------------------------------------------------------
# Notification helpers
# -------------------------------------------------------------------

def _format_slack_payload(payload: dict) -> dict:
    """Format alert payload as a Slack Block Kit message."""
    severity = payload.get("severity", "warning")
    color = "#ef4444" if severity == "critical" else "#f59e0b"
    return {
        "attachments": [{
            "color": color,
            "blocks": [
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": f"*{payload.get('rule_name', 'Alert')}*\n{payload.get('message', '')}",
                    },
                },
                {
                    "type": "context",
                    "elements": [
                        {"type": "mrkdwn", "text": f":bar_chart: `{payload.get('metric', '')}` = *{payload.get('value', '')}* (threshold: {payload.get('threshold', '')})"},
                        {"type": "mrkdwn", "text": f":satellite: Host: {payload.get('host', '*')}"},
                    ],
                },
            ],
        }]
    }


def _format_discord_payload(payload: dict) -> dict:
    """Format alert payload as a Discord embed."""
    severity = payload.get("severity", "warning")
    color = 0xEF4444 if severity == "critical" else 0xF59E0B
    return {
        "embeds": [{
            "title": payload.get("rule_name", "Accelera Alert"),
            "description": payload.get("message", ""),
            "color": color,
            "fields": [
                {"name": "Metric", "value": f"`{payload.get('metric', '')}`", "inline": True},
                {"name": "Value", "value": str(payload.get("value", "")), "inline": True},
                {"name": "Threshold", "value": str(payload.get("threshold", "")), "inline": True},
            ],
        }]
    }


def _send_webhook(payload: dict, url: str | None = None):
    """POST alert payload to webhook URL. Auto-detects Slack/Discord formatting."""
    from config import cfg
    url = url or cfg("ALERT_WEBHOOK_URL")
    if not url:
        return
    try:
        if "hooks.slack.com" in url or "slack" in url:
            data = _format_slack_payload(payload)
        elif "discord.com/api/webhooks" in url or "discord" in url:
            data = _format_discord_payload(payload)
        else:
            data = payload
        http_requests.post(url, json=data, timeout=5)
    except Exception as e:
        logging.getLogger(__name__).warning("Webhook delivery failed: %s", e)


def _send_email(subject: str, body: str):
    """Send alert email via SMTP."""
    if not all([ALERT_EMAIL_SMTP_HOST, ALERT_EMAIL_FROM, ALERT_EMAIL_TO]):
        return
    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = ALERT_EMAIL_FROM
        msg["To"] = ALERT_EMAIL_TO

        with smtplib.SMTP(ALERT_EMAIL_SMTP_HOST, ALERT_EMAIL_SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            if ALERT_EMAIL_PASSWORD:
                server.login(ALERT_EMAIL_FROM, ALERT_EMAIL_PASSWORD)
            server.sendmail(ALERT_EMAIL_FROM, ALERT_EMAIL_TO.split(","), msg.as_string())
    except Exception as e:
        logging.getLogger(__name__).warning("Email delivery failed: %s", e)


# -------------------------------------------------------------------
# Alert evaluation
# -------------------------------------------------------------------

def _compare(value: float, threshold: float, comparison: str) -> bool:
    ops = {
        "gt": value > threshold,
        ">": value > threshold,
        "gte": value >= threshold,
        ">=": value >= threshold,
        "lt": value < threshold,
        "<": value < threshold,
        "lte": value <= threshold,
        "<=": value <= threshold,
        "eq": value == threshold,
        "==": value == threshold,
    }
    return ops.get(comparison, False)


def _extract_metric(gpu: dict, metric: str) -> float | None:
    mapping = {
        "utilization": gpu.get("utilization"),
        "temperature": gpu.get("temperature"),
        "power_draw": gpu.get("power", {}).get("draw"),
        "power_limit": gpu.get("power", {}).get("limit"),
        "memory_used": gpu.get("memory", {}).get("used"),
        "memory_total": gpu.get("memory", {}).get("total"),
        "memory_percent": (
            (gpu["memory"]["used"] / gpu["memory"]["total"] * 100)
            if gpu.get("memory", {}).get("total")
            else None
        ),
        "fan": gpu.get("fan"),
    }
    return mapping.get(metric)


_TOKEN_METRICS = frozenset({
    "tps", "total_tokens", "token_request_count", "avg_latency_sec",
})


def _extract_token_metric(metric: str) -> float | None:
    """Read the latest token stats from storage and return the requested metric."""
    try:
        stats = storage.get_token_stats(hours=1)
        summary = stats.get("summary", {})
        mapping = {
            "tps": summary.get("current_tps", 0.0),
            "total_tokens": float(summary.get("total_tokens", 0)),
            "token_request_count": float(summary.get("total_requests", 0)),
            "avg_latency_sec": (
                summary.get("total_duration_sec", 0.0) / summary["total_requests"]
                if summary.get("total_requests")
                else 0.0
            ),
        }
        return mapping.get(metric)
    except Exception:
        return None


def _fire_alert(rule: dict, value: float, now: float, gpu_id: str | None = None, label: str = ""):
    """Record alert event, update cooldown, and dispatch notifications."""
    rule_id = rule["id"]
    metric = rule["metric"]
    message = f"[Accelera Alert] {rule['name']}: {label}{metric}={value} {rule['comparison']} {rule['threshold']}"

    severity = "critical" if metric in ("temperature", "tps") else "warning"
    event = {
        "rule_id": rule_id,
        "rule_name": rule["name"],
        "metric": metric,
        "value": value,
        "threshold": rule["threshold"],
        "gpu_id": gpu_id,
        "host": rule.get("host_filter", "*"),
        "message": message,
        "severity": severity,
        "created_at": now,
    }
    storage.save_alert_event(event)

    with _fire_lock:
        _last_fired[rule_id] = now

    if rule.get("notify_webhook"):
        threading.Thread(target=_send_webhook, args=(event,), daemon=True).start()
    if rule.get("notify_email"):
        threading.Thread(
            target=_send_email,
            args=(f"Accelera Alert: {rule['name']}", message),
            daemon=True,
        ).start()


def evaluate_alerts():
    """Run all enabled alert rules against current GPU state and token metrics. Called periodically."""
    try:
        gpus = get_gpus()
    except Exception:
        gpus = []

    rules = storage.load_alert_rules()
    now = time.time()

    for rule in rules:
        if not rule.get("enabled", True):
            continue

        rule_id = rule["id"]
        cooldown = rule.get("cooldown_seconds", 300)

        with _fire_lock:
            if rule_id in _last_fired and (now - _last_fired[rule_id]) < cooldown:
                continue

        metric = rule["metric"]

        # ── Token-based metrics (fleet-level, not per-GPU) ──
        if metric in _TOKEN_METRICS:
            value = _extract_token_metric(metric)
            if value is None:
                continue
            if _compare(value, rule["threshold"], rule["comparison"]):
                _fire_alert(rule, value, now, label="Fleet ")
            continue

        # ── GPU-based metrics (per-GPU) ──
        for gpu in gpus:
            gpu_id_str = str(gpu["id"])
            gpu_filter = rule.get("gpu_filter", "*")
            if gpu_filter != "*" and gpu_id_str != gpu_filter:
                continue

            value = _extract_metric(gpu, metric)
            if value is None:
                continue

            if _compare(value, rule["threshold"], rule["comparison"]):
                _fire_alert(
                    rule, value, now,
                    gpu_id=gpu_id_str,
                    label=f"GPU {gpu['id']} ({gpu['name']}) ",
                )


# -------------------------------------------------------------------
# Routes
# -------------------------------------------------------------------

@alerts_bp.route("/api/alerts/rules", methods=["GET"])
def list_rules():
    """List all alert rules."""
    return jsonify(storage.load_alert_rules())


@alerts_bp.route("/api/alerts/rules", methods=["POST"])
def create_rule():
    """Create a new alert rule."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    required = ("name", "metric", "threshold", "comparison")
    for field in required:
        if field not in data:
            return jsonify({"error": f"Missing field: {field}"}), 400

    now = datetime.utcnow().isoformat() + "Z"
    rule = {
        "id": str(uuid.uuid4()),
        "name": data["name"],
        "metric": data["metric"],
        "threshold": float(data["threshold"]),
        "comparison": data["comparison"],
        "gpu_filter": data.get("gpu_filter", "*"),
        "host_filter": data.get("host_filter", "*"),
        "enabled": data.get("enabled", True),
        "cooldown_seconds": data.get("cooldown_seconds", 300),
        "notify_webhook": data.get("notify_webhook", False),
        "notify_email": data.get("notify_email", False),
        "created_at": now,
        "updated_at": now,
    }

    if storage.save_alert_rule(rule):
        return jsonify(rule), 201
    return jsonify({"error": "Failed to save rule"}), 500


@alerts_bp.route("/api/alerts/rules/<rule_id>", methods=["PUT"])
def update_rule(rule_id):
    """Update an existing alert rule."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    existing = storage.load_alert_rules()
    found = None
    for r in existing:
        if r["id"] == rule_id:
            found = r
            break
    if not found:
        return jsonify({"error": "Rule not found"}), 404

    for key in ("name", "metric", "threshold", "comparison", "gpu_filter",
                "host_filter", "enabled", "cooldown_seconds", "notify_webhook", "notify_email"):
        if key in data:
            found[key] = data[key]
    found["updated_at"] = datetime.utcnow().isoformat() + "Z"

    if storage.save_alert_rule(found):
        return jsonify(found)
    return jsonify({"error": "Failed to update rule"}), 500


@alerts_bp.route("/api/alerts/rules/<rule_id>", methods=["DELETE"])
def remove_rule(rule_id):
    """Delete an alert rule."""
    if storage.delete_alert_rule(rule_id):
        return jsonify({"message": "Rule deleted"})
    return jsonify({"error": "Rule not found"}), 404


@alerts_bp.route("/api/alerts/events", methods=["GET"])
def list_events():
    """List recent alert events."""
    limit = int(request.args.get("limit", 200))
    return jsonify(storage.load_alert_events(limit))


@alerts_bp.route("/api/alerts/events/<int:event_id>/acknowledge", methods=["POST"])
def ack_event(event_id):
    """Acknowledge an alert event."""
    if storage.acknowledge_alert(event_id):
        return jsonify({"message": "Acknowledged"})
    return jsonify({"error": "Event not found"}), 404


@alerts_bp.route("/api/alerts/webhook", methods=["GET"])
def get_webhook_config():
    """Return the current webhook URL (masked for security)."""
    from config import cfg
    url = cfg("ALERT_WEBHOOK_URL")
    return jsonify({
        "url": url[:30] + "..." if len(url) > 30 else url,
        "configured": bool(url),
        "type": (
            "slack" if url and ("hooks.slack.com" in url or "slack" in url)
            else "discord" if url and ("discord.com" in url)
            else "generic" if url
            else "none"
        ),
    })


@alerts_bp.route("/api/alerts/webhook", methods=["PUT"])
def set_webhook_config():
    """Update the webhook URL at runtime."""
    from config import set_runtime, cfg
    data = request.get_json()
    if not data or "url" not in data:
        return jsonify({"error": "Missing 'url' field"}), 400

    url = data["url"].strip()
    set_runtime("ALERT_WEBHOOK_URL", url)
    storage.set_config("ALERT_WEBHOOK_URL", url)
    return jsonify({"message": "Webhook URL updated", "configured": bool(url)})


@alerts_bp.route("/api/alerts/webhook/test", methods=["POST"])
def test_webhook():
    """Send a test notification to the configured webhook."""
    from config import cfg
    url = cfg("ALERT_WEBHOOK_URL")
    if not url:
        return jsonify({"error": "No webhook URL configured"}), 400

    test_payload = {
        "rule_id": "test",
        "rule_name": "Test Notification",
        "metric": "temperature",
        "value": 42,
        "threshold": 85,
        "gpu_id": "0",
        "host": "test-host",
        "message": "[Accelera Test] This is a test alert notification. If you see this, webhooks are working!",
        "severity": "warning",
        "created_at": time.time(),
    }
    try:
        _send_webhook(test_payload, url)
        return jsonify({"message": "Test notification sent"})
    except Exception as e:
        return jsonify({"error": f"Webhook delivery failed: {e}"}), 500
