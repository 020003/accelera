"""API token authentication helpers + management blueprint.

Token format
------------
    acc_<32 hex chars>          (38 chars total, 16 bytes of entropy)

Storage
-------
    prefix      = first 12 chars of the token (e.g. "acc_a1b2c3d4")
                  — indexed, shown in the UI for identification.
    token_hash  = bcrypt(full token) — verified on every request.

The plaintext token is shown to the user *only* at creation time; we
never store it.

Auth flow
---------
    Authorization: Bearer acc_<32hex>

The `api_token_required` decorator parses that header, looks up by
prefix, bcrypt-verifies, updates last_used_at, and stashes the token
record on `flask.g.api_token` for downstream handlers.

Endpoints
---------
    POST   /api/auth/tokens          (session-auth)  mint a new token
    GET    /api/auth/tokens          (session-auth)  list own tokens
    DELETE /api/auth/tokens/<id>     (session-auth)  revoke a token
"""

from __future__ import annotations

import functools
import logging
import secrets
import time
import uuid

import bcrypt
from flask import Blueprint, g, jsonify, request, session

import storage
from auth import login_required

log = logging.getLogger(__name__)

TOKEN_PREFIX = "acc_"
TOKEN_BYTES = 16  # 32 hex chars
TOKEN_LENGTH = len(TOKEN_PREFIX) + TOKEN_BYTES * 2
STORED_PREFIX_LEN = len(TOKEN_PREFIX) + 8  # "acc_a1b2c3d4"

VALID_SCOPES = {"read", "read:write"}

tokens_bp = Blueprint("api_tokens_mgmt", __name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _generate_token() -> str:
    return TOKEN_PREFIX + secrets.token_hex(TOKEN_BYTES)


def _parse_bearer(header_value: str | None) -> str | None:
    if not header_value:
        return None
    parts = header_value.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    tok = parts[1].strip()
    if not tok.startswith(TOKEN_PREFIX) or len(tok) != TOKEN_LENGTH:
        return None
    return tok


def _verify_token(plaintext: str) -> dict | None:
    """Look up by prefix, bcrypt-verify, return token record or None."""
    prefix = plaintext[:STORED_PREFIX_LEN]
    candidates = storage.get_api_tokens_by_prefix(prefix)
    now = time.time()
    for c in candidates:
        if c.get("expires_at") and c["expires_at"] < now:
            continue
        try:
            if bcrypt.checkpw(plaintext.encode(), c["token_hash"].encode()):
                return c
        except Exception:
            continue
    return None


def api_token_required(scope: str = "read"):
    """Decorator: gate an endpoint behind a valid bearer token.

    Usage::

        @api_token_required()
        def my_endpoint(): ...

        @api_token_required(scope="read:write")
        def mutating_endpoint(): ...
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            tok = _parse_bearer(request.headers.get("Authorization"))
            if not tok:
                return jsonify({
                    "error": "Bearer token required",
                    "docs": "/api/v1",
                }), 401
            record = _verify_token(tok)
            if not record:
                return jsonify({"error": "Invalid or expired token"}), 401

            # Scope check.  "read:write" implies "read".
            granted = record.get("scopes") or "read"
            if scope == "read:write" and granted != "read:write":
                return jsonify({"error": "Token lacks read:write scope"}), 403

            # Touch last_used (best-effort, never blocks the request).
            storage.touch_api_token(record["id"])

            g.api_token = record
            return fn(*args, **kwargs)
        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Token management (session-auth — managed from the Settings UI)
# ---------------------------------------------------------------------------

@tokens_bp.route("/api/auth/tokens", methods=["GET"])
@login_required
def list_tokens():
    """List all non-revoked tokens.  Admins see every user's tokens;
    others only see their own."""
    rows = storage.list_api_tokens()
    me = session.get("user")
    if session.get("role") != "admin":
        rows = [r for r in rows if r["created_by"] == me]
    return jsonify({"tokens": rows})


@tokens_bp.route("/api/auth/tokens", methods=["POST"])
@login_required
def create_token():
    """Mint a new token.  Returns the plaintext exactly once."""
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    scopes = (data.get("scopes") or "read").strip()
    expires_in_days = data.get("expiresInDays")

    if not name or len(name) > 80:
        return jsonify({"error": "name is required (1–80 chars)"}), 400
    if scopes not in VALID_SCOPES:
        return jsonify({"error": f"scopes must be one of {sorted(VALID_SCOPES)}"}), 400

    expires_at = None
    if expires_in_days is not None:
        try:
            days = int(expires_in_days)
            if days <= 0 or days > 3650:
                raise ValueError
            expires_at = time.time() + days * 86400
        except (TypeError, ValueError):
            return jsonify({"error": "expiresInDays must be 1–3650"}), 400

    plaintext = _generate_token()
    token_id = uuid.uuid4().hex
    prefix = plaintext[:STORED_PREFIX_LEN]
    token_hash = bcrypt.hashpw(plaintext.encode(), bcrypt.gensalt()).decode()

    if not storage.create_api_token(
        token_id=token_id,
        name=name,
        prefix=prefix,
        token_hash=token_hash,
        scopes=scopes,
        created_by=session["user"],
        expires_at=expires_at,
    ):
        return jsonify({"error": "Failed to create token"}), 500

    log.info("API token created id=%s name=%s by=%s scopes=%s",
             token_id, name, session["user"], scopes)

    return jsonify({
        "id": token_id,
        "name": name,
        "prefix": prefix,
        "scopes": scopes,
        "created_by": session["user"],
        "expires_at": expires_at,
        # Plaintext: shown once, never stored.
        "token": plaintext,
        "warning": "Copy this token now — it will not be shown again.",
    }), 201


@tokens_bp.route("/api/auth/tokens/<token_id>", methods=["DELETE"])
@login_required
def revoke_token(token_id: str):
    if session.get("role") == "admin":
        ok = storage.admin_revoke_api_token(token_id)
    else:
        ok = storage.revoke_api_token(token_id, session["user"])
    if not ok:
        return jsonify({"error": "Token not found or already revoked"}), 404
    log.info("API token revoked id=%s by=%s", token_id, session.get("user"))
    return jsonify({"message": "Token revoked"})
