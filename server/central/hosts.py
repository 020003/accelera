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


def _restore_url(url: str) -> str:
    """Nginx's default `merge_slashes on` collapses the `//` after the
    scheme when the client URL-encodes the slashes (e.g. browser sends
    ``%2F%2F`` → nginx decodes → ``//`` → merged → ``/``).  So we
    receive ``http:/host:port/path`` instead of ``http://host:port/path``.
    Repair the URL before we use it as a DB key."""
    if url.startswith("http:/") and not url.startswith("http://"):
        return "http://" + url[len("http:/"):]
    if url.startswith("https:/") and not url.startswith("https://"):
        return "https://" + url[len("https:/"):]
    return url


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


@hosts_bp.route("/api/hosts/order", methods=["PUT"])
@login_required
def reorder_hosts():
    """Persist a new host ordering.  Body: a JSON list of host URLs."""
    data = request.get_json()
    if not isinstance(data, list) or not all(isinstance(u, str) for u in data):
        return jsonify({"error": "Body must be a JSON list of URLs"}), 400
    if storage.reorder_hosts(data):
        return jsonify({"hosts": storage.load_hosts()})
    return jsonify({"error": "URL set does not match stored hosts"}), 400


@hosts_bp.route("/api/hosts/<path:url>", methods=["DELETE"])
@login_required
def delete_host(url):
    """Remove a host by URL."""
    url = _restore_url(url)
    if storage.delete_host(url):
        return jsonify({"message": "Host deleted"})
    return jsonify({"error": "Host not found"}), 404


@hosts_bp.route("/api/hosts/<path:url>", methods=["PATCH"])
@login_required
def update_host(url):
    """Update mutable fields of a host (currently: display name)."""
    url = _restore_url(url)
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Missing name"}), 400
    if len(name) > 80:
        return jsonify({"error": "Name too long (max 80 chars)"}), 400
    if storage.update_host(url, name):
        return jsonify({"url": url, "name": name})
    return jsonify({"error": "Host not found"}), 404
