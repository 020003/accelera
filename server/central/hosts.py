"""Host management blueprint — CRUD for monitored GPU servers."""

from datetime import datetime, timezone
from urllib.parse import urlparse

from flask import Blueprint, jsonify, request

import storage
from auth import login_required

hosts_bp = Blueprint("hosts", __name__)


def _is_valid_host_url(url: str) -> bool:
    try:
        p = urlparse(url)
        return p.scheme in ("http", "https") and bool(p.hostname)
    except Exception:
        return False


@hosts_bp.route("/api/hosts", methods=["GET"])
@login_required
def get_hosts():
    """Return all configured GPU exporter hosts."""
    return jsonify(storage.load_hosts())


@hosts_bp.route("/api/hosts", methods=["POST"])
@login_required
def add_host():
    """Add a new GPU exporter host."""
    data = request.get_json()
    if not data or "url" not in data or "name" not in data:
        return jsonify({"error": "Missing url or name"}), 400

    url = data["url"].strip()
    name = data["name"].strip()

    if not _is_valid_host_url(url):
        return jsonify({"error": "Invalid URL"}), 400

    existing = storage.load_hosts()
    for h in existing:
        if h["url"] == url:
            return jsonify({"error": "Host already exists"}), 409

    created_at = datetime.now(timezone.utc).isoformat()
    if storage.save_host(url, name, created_at):
        return jsonify({"url": url, "name": name, "created_at": created_at}), 201
    return jsonify({"error": "Failed to save host"}), 500


@hosts_bp.route("/api/hosts/<path:url>", methods=["DELETE"])
@login_required
def delete_host(url):
    """Remove a host by URL."""
    if storage.delete_host(url):
        return jsonify({"message": "Host deleted"})
    return jsonify({"error": "Host not found"}), 404
