"""Runtime configuration blueprint.

Allows reading and updating configuration values through the API.
Changes are persisted in SQLite and take effect immediately.

Endpoints:
  GET  /api/settings          — read all config (secrets masked)
  PUT  /api/settings          — update one or more config keys
  POST /api/settings/reset    — delete runtime overrides (revert to env/defaults)
"""

from flask import Blueprint, jsonify, request

from config import (
    MUTABLE_KEYS,
    cfg,
    cfg_bool,
    get_visible_config,
    set_runtime,
)
import storage

settings_bp = Blueprint("settings", __name__)


@settings_bp.route("/api/settings", methods=["GET"])
def get_settings():
    """Return all configuration values (secrets are masked)."""
    config = get_visible_config()
    # Mark which keys are mutable via the GUI
    mutable = {k: k in MUTABLE_KEYS for k in config}
    return jsonify({
        "config": config,
        "mutable": mutable,
    })


@settings_bp.route("/api/settings", methods=["PUT"])
def update_settings():
    """Update one or more config keys.

    Body: { "settings": { "KEY": "value", ... } }
    Only keys listed in MUTABLE_KEYS are accepted.
    """
    data = request.get_json()
    if not data or "settings" not in data:
        return jsonify({"error": "Missing 'settings' object in body"}), 400

    updates = data["settings"]
    if not isinstance(updates, dict):
        return jsonify({"error": "'settings' must be an object"}), 400

    applied = {}
    rejected = {}

    for key, value in updates.items():
        if key not in MUTABLE_KEYS:
            rejected[key] = "not a mutable setting"
            continue

        str_value = str(value)

        # Persist to SQLite
        if not storage.set_config(key, str_value):
            rejected[key] = "failed to persist"
            continue

        # Apply in-memory
        set_runtime(key, str_value)
        applied[key] = str_value

    return jsonify({
        "applied": applied,
        "rejected": rejected,
        "message": f"{len(applied)} setting(s) updated",
    })


@settings_bp.route("/api/settings/reset", methods=["POST"])
def reset_settings():
    """Delete runtime overrides for the given keys (or all if none specified).

    Body: { "keys": ["KEY1", "KEY2"] }   — optional, resets all if omitted.
    """
    data = request.get_json() or {}
    keys = data.get("keys")

    if keys:
        for key in keys:
            storage.delete_config(key)
            set_runtime(key, "")  # will fall through to _DEFAULTS via cfg()
        # Re-load from DB to get clean state
        from config import load_runtime_overrides
        load_runtime_overrides(storage.get_all_config())
        return jsonify({"message": f"Reset {len(keys)} setting(s)"})
    else:
        # Reset everything
        all_cfg = storage.get_all_config()
        for key in all_cfg:
            storage.delete_config(key)
        from config import load_runtime_overrides, _runtime, _runtime_lock
        with _runtime_lock:
            _runtime.clear()
        return jsonify({"message": "All runtime overrides cleared"})
