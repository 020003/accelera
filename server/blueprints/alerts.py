"""Alerting blueprint – threshold-based alerts with webhook/email notifications."""

import json
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

def _send_webhook(payload: dict):
    """POST alert payload to configured webhook URL."""
    url = ALERT_WEBHOOK_URL
    if not url:
        return
    try:
        http_requests.post(url, json=payload, timeout=5)
    except Exception as e:
        print(f"[alerts] Webhook delivery failed: {e}")


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
        print(f"[alerts] Email delivery failed: {e}")


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


def evaluate_alerts():
    """Run all enabled alert rules against current GPU state. Called periodically."""
    try:
        gpus = get_gpus()
    except Exception:
        return

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

        for gpu in gpus:
            gpu_id_str = str(gpu["id"])
            gpu_filter = rule.get("gpu_filter", "*")
            if gpu_filter != "*" and gpu_id_str != gpu_filter:
                continue

            value = _extract_metric(gpu, rule["metric"])
            if value is None:
                continue

            if _compare(value, rule["threshold"], rule["comparison"]):
                message = (
                    f"[Accelera Alert] {rule['name']}: GPU {gpu['id']} ({gpu['name']}) "
                    f"{rule['metric']}={value} {rule['comparison']} {rule['threshold']}"
                )

                event = {
                    "rule_id": rule_id,
                    "rule_name": rule["name"],
                    "metric": rule["metric"],
                    "value": value,
                    "threshold": rule["threshold"],
                    "gpu_id": gpu_id_str,
                    "host": rule.get("host_filter", "*"),
                    "message": message,
                    "severity": "critical" if rule["metric"] == "temperature" else "warning",
                    "created_at": now,
                }
                storage.save_alert_event(event)

                with _fire_lock:
                    _last_fired[rule_id] = now

                # Notifications
                if rule.get("notify_webhook"):
                    threading.Thread(target=_send_webhook, args=(event,), daemon=True).start()
                if rule.get("notify_email"):
                    threading.Thread(
                        target=_send_email,
                        args=(f"Accelera Alert: {rule['name']}", message),
                        daemon=True,
                    ).start()


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
