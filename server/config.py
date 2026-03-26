"""Centralized configuration loaded from environment variables.

Runtime overrides from SQLite take precedence over env vars.
Use ``cfg(key)`` for dynamic lookups, or the module-level constants
for values that are only read at startup (Flask host/port, etc.).
"""

import os
import secrets
import threading
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Defaults — env vars set the baseline
# ---------------------------------------------------------------------------
_DEFAULTS: dict[str, str] = {
    # Flask (startup-only, not overridable at runtime)
    "FLASK_HOST": os.getenv("FLASK_HOST", "0.0.0.0"),
    "FLASK_PORT": os.getenv("FLASK_PORT", "5000"),
    "FLASK_DEBUG": os.getenv("FLASK_DEBUG", "false"),
    "FLASK_SECRET_KEY": os.getenv("FLASK_SECRET_KEY", "") or secrets.token_hex(32),
    # CORS
    "CORS_ORIGINS": os.getenv("CORS_ORIGINS", "*"),
    # GPU monitoring
    "NVIDIA_SMI_PATH": os.getenv("NVIDIA_SMI_PATH", "nvidia-smi"),
    "GPU_COLLECT_INTERVAL": os.getenv("GPU_COLLECT_INTERVAL", "60"),
    "HISTORICAL_DATA_RETENTION": os.getenv("HISTORICAL_DATA_RETENTION", "168"),
    # Ollama
    "OLLAMA_DISCOVER_TIMEOUT": os.getenv("OLLAMA_DISCOVER_TIMEOUT", "3000"),
    "OLLAMA_DEFAULT_PORT": os.getenv("OLLAMA_DEFAULT_PORT", "11434"),
    # Alerting
    "ALERT_WEBHOOK_URL": os.getenv("ALERT_WEBHOOK_URL", ""),
    "ALERT_EMAIL_SMTP_HOST": os.getenv("ALERT_EMAIL_SMTP_HOST", ""),
    "ALERT_EMAIL_SMTP_PORT": os.getenv("ALERT_EMAIL_SMTP_PORT", "587"),
    "ALERT_EMAIL_FROM": os.getenv("ALERT_EMAIL_FROM", ""),
    "ALERT_EMAIL_TO": os.getenv("ALERT_EMAIL_TO", ""),
    "ALERT_EMAIL_PASSWORD": os.getenv("ALERT_EMAIL_PASSWORD", ""),
    # Prometheus
    "PROMETHEUS_ENABLED": os.getenv("PROMETHEUS_ENABLED", "true"),
    # Storage
    "DATA_DIR": os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "data")),
    # Logging
    "LOG_LEVEL": os.getenv("LOG_LEVEL", "INFO"),
}

# Runtime overrides from SQLite (populated after init_db)
_runtime: dict[str, str] = {}
_runtime_lock = threading.Lock()

# Keys that may be changed at runtime through the GUI
MUTABLE_KEYS = frozenset({
    "GPU_COLLECT_INTERVAL",
    "HISTORICAL_DATA_RETENTION",
    "CORS_ORIGINS",
    "PROMETHEUS_ENABLED",
    "ALERT_WEBHOOK_URL",
    "LOG_LEVEL",
})

# Keys whose values should never be returned to the frontend
_SECRET_KEYS = frozenset({
    "FLASK_SECRET_KEY",
    "ALERT_EMAIL_PASSWORD",
})


def cfg(key: str) -> str:
    """Return the effective value for *key* (runtime override > env > default)."""
    with _runtime_lock:
        if key in _runtime:
            return _runtime[key]
    return _DEFAULTS.get(key, "")


def cfg_bool(key: str) -> bool:
    return cfg(key).lower() in ("true", "1", "yes")


def cfg_int(key: str) -> int:
    try:
        return int(cfg(key))
    except (ValueError, TypeError):
        return 0


def set_runtime(key: str, value: str):
    """Set a runtime override (in-memory). Caller is responsible for persisting."""
    with _runtime_lock:
        _runtime[key] = value


def load_runtime_overrides(overrides: dict[str, str]):
    """Bulk-load runtime overrides (called once after init_db)."""
    with _runtime_lock:
        _runtime.update(overrides)


def get_visible_config() -> dict[str, str]:
    """Return all config as a dict, masking secret values."""
    result = {}
    for key in _DEFAULTS:
        val = cfg(key)
        if key in _SECRET_KEYS:
            result[key] = "••••••••" if val else ""
        else:
            result[key] = val
    return result


# ---------------------------------------------------------------------------
# Backward-compatible module-level constants (startup values)
# ---------------------------------------------------------------------------
FLASK_HOST = _DEFAULTS["FLASK_HOST"]
FLASK_PORT = int(_DEFAULTS["FLASK_PORT"])
FLASK_DEBUG = _DEFAULTS["FLASK_DEBUG"].lower() == "true"
FLASK_SECRET_KEY = _DEFAULTS["FLASK_SECRET_KEY"]
CORS_ORIGINS = _DEFAULTS["CORS_ORIGINS"]
NVIDIA_SMI_PATH = _DEFAULTS["NVIDIA_SMI_PATH"]
GPU_COLLECT_INTERVAL = int(_DEFAULTS["GPU_COLLECT_INTERVAL"])
HISTORICAL_DATA_RETENTION = int(_DEFAULTS["HISTORICAL_DATA_RETENTION"])
OLLAMA_DISCOVER_TIMEOUT = int(_DEFAULTS["OLLAMA_DISCOVER_TIMEOUT"])
OLLAMA_DEFAULT_PORT = int(_DEFAULTS["OLLAMA_DEFAULT_PORT"])
ALERT_WEBHOOK_URL = _DEFAULTS["ALERT_WEBHOOK_URL"]
ALERT_EMAIL_SMTP_HOST = _DEFAULTS["ALERT_EMAIL_SMTP_HOST"]
ALERT_EMAIL_SMTP_PORT = int(_DEFAULTS["ALERT_EMAIL_SMTP_PORT"])
ALERT_EMAIL_FROM = _DEFAULTS["ALERT_EMAIL_FROM"]
ALERT_EMAIL_TO = _DEFAULTS["ALERT_EMAIL_TO"]
ALERT_EMAIL_PASSWORD = _DEFAULTS["ALERT_EMAIL_PASSWORD"]
PROMETHEUS_ENABLED = _DEFAULTS["PROMETHEUS_ENABLED"].lower() == "true"
DATA_DIR = _DEFAULTS["DATA_DIR"]
LOG_LEVEL = _DEFAULTS["LOG_LEVEL"]
