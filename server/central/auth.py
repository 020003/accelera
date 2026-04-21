"""Server-side authentication: bcrypt passwords, signed session cookies.

Endpoints:
  POST /api/auth/login     — verify credentials, set session cookie
  POST /api/auth/logout    — clear session cookie
  GET  /api/auth/status    — check current session
  POST /api/auth/setup     — initial admin account creation (first-run only)
  PUT  /api/auth/password  — change own password (authenticated)
"""

import functools
import logging

import bcrypt
from flask import Blueprint, jsonify, request, session

import storage

log = logging.getLogger(__name__)

auth_bp = Blueprint("auth", __name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return False


def login_required(fn):
    """Decorator — returns 401 if no valid session."""
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("user"):
            return jsonify({"error": "Authentication required"}), 401
        return fn(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@auth_bp.route("/api/auth/setup", methods=["POST"])
def setup():
    """Create the initial admin account. Only works when no users exist."""
    if storage.count_users() > 0:
        return jsonify({"error": "Setup already completed"}), 403

    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or len(username) < 2:
        return jsonify({"error": "Username must be at least 2 characters"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    pw_hash = hash_password(password)
    if not storage.create_user(username, pw_hash, role="admin"):
        return jsonify({"error": "Failed to create user"}), 500

    session["user"] = username
    session["role"] = "admin"
    session.permanent = True

    log.info("Initial admin account created: %s", username)
    return jsonify({"message": "Admin account created", "username": username}), 201


@auth_bp.route("/api/auth/login", methods=["POST"])
def login():
    """Verify credentials and create a session."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    user = storage.get_user(username)
    if not user or not verify_password(password, user["password_hash"]):
        return jsonify({"error": "Invalid credentials"}), 401

    session["user"] = user["username"]
    session["role"] = user["role"]
    session.permanent = True

    return jsonify({
        "message": "Logged in",
        "username": user["username"],
        "role": user["role"],
    })


@auth_bp.route("/api/auth/logout", methods=["POST"])
def logout():
    """Clear the session."""
    session.clear()
    return jsonify({"message": "Logged out"})


@auth_bp.route("/api/auth/status", methods=["GET"])
def status():
    """Return current authentication state."""
    user = session.get("user")
    needs_setup = storage.count_users() == 0

    return jsonify({
        "authenticated": user is not None,
        "username": user,
        "role": session.get("role"),
        "needsSetup": needs_setup,
    })


@auth_bp.route("/api/auth/password", methods=["PUT"])
@login_required
def change_password():
    """Change the current user's password."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    current = data.get("currentPassword") or ""
    new_pw = data.get("newPassword") or ""

    if len(new_pw) < 6:
        return jsonify({"error": "New password must be at least 6 characters"}), 400

    user = storage.get_user(session["user"])
    if not user or not verify_password(current, user["password_hash"]):
        return jsonify({"error": "Current password is incorrect"}), 401

    if not storage.update_password(session["user"], hash_password(new_pw)):
        return jsonify({"error": "Failed to update password"}), 500

    return jsonify({"message": "Password updated"})
