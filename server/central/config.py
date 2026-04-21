"""Central backend configuration — all values from environment with sane defaults."""

import os
import secrets

DATA_DIR = os.environ.get("DATA_DIR", "/app/data")
os.makedirs(DATA_DIR, exist_ok=True)


def _get_secret_key() -> str:
    """Return a stable secret key: env var > file > generated and saved."""
    env_key = os.environ.get("SECRET_KEY")
    if env_key:
        return env_key
    key_path = os.path.join(DATA_DIR, ".secret_key")
    if os.path.isfile(key_path):
        return open(key_path).read().strip()
    key = secrets.token_hex(32)
    with open(key_path, "w") as f:
        f.write(key)
    return key


SECRET_KEY = _get_secret_key()
SESSION_LIFETIME_HOURS = int(os.environ.get("SESSION_LIFETIME_HOURS", "24"))
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*")
HOST = os.environ.get("FLASK_HOST", "0.0.0.0")
PORT = int(os.environ.get("FLASK_PORT", "5001"))
DEBUG = os.environ.get("FLASK_DEBUG", "false").lower() == "true"
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
