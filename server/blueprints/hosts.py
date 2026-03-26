"""Host management blueprint – CRUD for monitored GPU servers."""

from datetime import datetime

from flask import Blueprint, jsonify, request

import storage
from utils import is_valid_host_url

hosts_bp = Blueprint("hosts", __name__)


@hosts_bp.route("/api/hosts", methods=["GET"])
def get_hosts():
    """Get all configured hosts."""
    return jsonify(storage.load_hosts())


@hosts_bp.route("/api/hosts", methods=["POST"])
def add_host():
    """Add a new host."""
    data = request.get_json()
    if not data or "url" not in data or "name" not in data:
        return jsonify({"error": "Missing url or name"}), 400

    if not is_valid_host_url(data["url"]):
        return jsonify({"error": "Invalid URL — must be http(s) with a valid host"}), 400

    # Check if host already exists
    existing = storage.load_hosts()
    for host in existing:
        if host["url"] == data["url"]:
            return jsonify({"error": "Host already exists"}), 409

    created_at = datetime.utcnow().isoformat() + "Z"
    new_host = {
        "url": data["url"],
        "name": data["name"],
        "isConnected": False,
        "createdAt": created_at,
    }

    if storage.save_host(data["url"], data["name"], created_at):
        return jsonify(new_host), 201
    else:
        return jsonify({"error": "Failed to save host"}), 500


@hosts_bp.route("/api/hosts/<path:url>", methods=["DELETE"])
def delete_host(url):
    """Delete a host by URL."""
    if storage.delete_host(url):
        return jsonify({"message": "Host deleted"}), 200
    else:
        return jsonify({"error": "Host not found"}), 404
