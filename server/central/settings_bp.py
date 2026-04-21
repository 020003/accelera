"""Settings blueprint — fleet-wide configuration persistence.

Stores dashboard preferences (refresh interval, energy rate, currency, etc.)
in the central database so they're shared across all browsers.
"""

from flask import Blueprint, jsonify, request

import storage
from auth import login_required

settings_bp = Blueprint("settings", __name__)

# Keys that the frontend may read/write
ALLOWED_KEYS = frozenset({
    "refresh_interval",
    "energy_rate",
    "currency",
    "theme",
    "webhook_url",
    "webhook_enabled",
    "demo_mode",
})


@settings_bp.route("/api/settings", methods=["GET"])
@login_required
def get_settings():
    """Return all stored settings."""
    return jsonify(storage.get_all_settings())


@settings_bp.route("/api/settings", methods=["PUT"])
@login_required
def update_settings():
    """Update one or more settings.

    Body: { "key": "value", ... }
    """
    data = request.get_json()
    if not data or not isinstance(data, dict):
        return jsonify({"error": "Body must be a JSON object"}), 400

    applied = {}
    rejected = {}

    for key, value in data.items():
        if key not in ALLOWED_KEYS:
            rejected[key] = "unknown setting"
            continue
        if storage.set_setting(key, str(value)):
            applied[key] = str(value)
        else:
            rejected[key] = "failed to persist"

    return jsonify({"applied": applied, "rejected": rejected})
