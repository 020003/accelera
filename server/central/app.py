"""Accelera Central Backend — auth, hosts, and settings API.

This is the single source of truth for configuration. The frontend
talks to this service; GPU exporters remain lightweight data agents.
"""

import logging
import sys
from datetime import timedelta

from flask import Flask
from flask_cors import CORS

from config import CORS_ORIGINS, HOST, PORT, DEBUG, LOG_LEVEL, SECRET_KEY, SESSION_LIFETIME_HOURS
import storage

# -------------------------------------------------------------------
# Logging
# -------------------------------------------------------------------
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL.upper(), logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("accelera.central")

# -------------------------------------------------------------------
# App
# -------------------------------------------------------------------
app = Flask(__name__)
app.secret_key = SECRET_KEY
app.permanent_session_lifetime = timedelta(hours=SESSION_LIFETIME_HOURS)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = False  # Set True when using HTTPS

if CORS_ORIGINS == "*":
    CORS(app, origins="*", supports_credentials=True)
else:
    CORS(app, origins=CORS_ORIGINS.split(","), supports_credentials=True)

# Init DB
storage.init_db()

# Register blueprints
from auth import auth_bp
from hosts import hosts_bp
from settings_bp import settings_bp

app.register_blueprint(auth_bp)
app.register_blueprint(hosts_bp)
app.register_blueprint(settings_bp)


@app.route("/health")
def health():
    return "ok\n", 200


@app.errorhandler(400)
def _bad_request(e):
    from flask import jsonify
    return jsonify({"error": str(e)}), 400


@app.errorhandler(404)
def _not_found(e):
    from flask import jsonify
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def _internal(e):
    log.exception("Unhandled error")
    from flask import jsonify
    return jsonify({"error": "Internal server error"}), 500


log.info("Central backend starting on %s:%s", HOST, PORT)

if __name__ == "__main__":
    app.run(host=HOST, port=PORT, debug=DEBUG)
