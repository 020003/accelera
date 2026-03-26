"""
Centralized data storage.

Provides thread-safe in-memory storage with optional SQLite persistence
so that historical data survives backend restarts.
"""

import json
import os
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from contextlib import contextmanager

from config import DATA_DIR, HISTORICAL_DATA_RETENTION

# ---------------------------------------------------------------------------
# In-memory stores (fast path)
# ---------------------------------------------------------------------------
historical_data: dict[str, deque] = defaultdict(lambda: deque(maxlen=1440))
workload_events: deque = deque(maxlen=1000)
topology_cache: dict = {}
alert_rules: list = []
alert_history: deque = deque(maxlen=5000)
data_lock = threading.Lock()

# ---------------------------------------------------------------------------
# SQLite persistence (survives restarts)
# ---------------------------------------------------------------------------
os.makedirs(DATA_DIR, exist_ok=True)
_DB_PATH = os.path.join(DATA_DIR, "accelera.db")
_local = threading.local()


def _get_db() -> sqlite3.Connection:
    """Return a thread-local SQLite connection."""
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(_DB_PATH, timeout=10)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA busy_timeout=5000")
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def init_db():
    """Create tables if they don't exist."""
    db = _get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS gpu_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            host TEXT NOT NULL,
            gpu_key TEXT NOT NULL,
            metric TEXT NOT NULL,
            value REAL NOT NULL,
            timestamp TEXT NOT NULL,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_gpu_history_key
            ON gpu_history(gpu_key, metric, created_at);

        CREATE TABLE IF NOT EXISTS hosts (
            url TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            is_connected INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS alert_rules (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            metric TEXT NOT NULL,
            threshold REAL NOT NULL,
            comparison TEXT NOT NULL,
            gpu_filter TEXT DEFAULT '*',
            host_filter TEXT DEFAULT '*',
            enabled INTEGER DEFAULT 1,
            cooldown_seconds INTEGER DEFAULT 300,
            notify_webhook INTEGER DEFAULT 0,
            notify_email INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS alert_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_id TEXT NOT NULL,
            rule_name TEXT NOT NULL,
            metric TEXT NOT NULL,
            value REAL NOT NULL,
            threshold REAL NOT NULL,
            gpu_id TEXT,
            host TEXT,
            message TEXT NOT NULL,
            severity TEXT DEFAULT 'warning',
            acknowledged INTEGER DEFAULT 0,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_alert_events_time
            ON alert_events(created_at);

        CREATE TABLE IF NOT EXISTS workload_events (
            id TEXT PRIMARY KEY,
            content TEXT,
            start_time TEXT,
            end_time TEXT,
            event_type TEXT,
            host TEXT,
            gpu TEXT,
            model TEXT,
            status TEXT,
            metadata TEXT,
            created_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS token_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            model TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL,
            generated_tokens INTEGER NOT NULL,
            request_count INTEGER NOT NULL,
            time_per_token_sum REAL NOT NULL DEFAULT 0,
            time_per_token_count INTEGER NOT NULL DEFAULT 0,
            request_duration_sum REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_token_snap_time
            ON token_snapshots(timestamp);
    """)
    db.commit()


# ---------------------------------------------------------------------------
# Runtime configuration persistence
# ---------------------------------------------------------------------------

def get_config(key: str, default: str | None = None) -> str | None:
    """Read a single config value from SQLite."""
    try:
        db = _get_db()
        row = db.execute("SELECT value FROM config WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default
    except Exception:
        return default


def get_all_config() -> dict[str, str]:
    """Read all runtime config overrides."""
    try:
        db = _get_db()
        rows = db.execute("SELECT key, value FROM config").fetchall()
        return {r["key"]: r["value"] for r in rows}
    except Exception:
        return {}


def set_config(key: str, value: str) -> bool:
    """Write a config value (insert or update)."""
    try:
        db = _get_db()
        db.execute(
            "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, time.time()),
        )
        db.commit()
        return True
    except Exception:
        return False


def delete_config(key: str) -> bool:
    """Delete a config override (reverts to env/default)."""
    try:
        db = _get_db()
        cur = db.execute("DELETE FROM config WHERE key = ?", (key,))
        db.commit()
        return cur.rowcount > 0
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Host persistence
# ---------------------------------------------------------------------------

def load_hosts() -> list[dict]:
    db = _get_db()
    rows = db.execute("SELECT url, name, is_connected, created_at FROM hosts").fetchall()
    return [{"url": r["url"], "name": r["name"],
             "isConnected": bool(r["is_connected"]),
             "createdAt": r["created_at"]} for r in rows]


def save_host(url: str, name: str, created_at: str) -> bool:
    try:
        db = _get_db()
        db.execute(
            "INSERT OR REPLACE INTO hosts (url, name, created_at) VALUES (?, ?, ?)",
            (url, name, created_at),
        )
        db.commit()
        return True
    except Exception:
        return False


def delete_host(url: str) -> bool:
    db = _get_db()
    cur = db.execute("DELETE FROM hosts WHERE url = ?", (url,))
    db.commit()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# GPU history persistence
# ---------------------------------------------------------------------------

def persist_gpu_sample(host: str, gpu_key: str, metric: str, value: float, timestamp: str):
    """Write a single metric sample to SQLite."""
    try:
        db = _get_db()
        db.execute(
            "INSERT INTO gpu_history (host, gpu_key, metric, value, timestamp, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (host, gpu_key, metric, value, timestamp, time.time()),
        )
        db.commit()
    except Exception:
        pass


def prune_old_history():
    """Delete samples older than retention window."""
    try:
        cutoff = time.time() - HISTORICAL_DATA_RETENTION * 3600
        db = _get_db()
        db.execute("DELETE FROM gpu_history WHERE created_at < ?", (cutoff,))
        db.commit()
    except Exception:
        pass


def load_history_from_db(metric: str, hours: int) -> dict:
    """Load historical samples grouped by gpu_key for the last N hours."""
    cutoff = time.time() - hours * 3600
    db = _get_db()
    rows = db.execute(
        "SELECT gpu_key, value, timestamp FROM gpu_history "
        "WHERE metric = ? AND created_at >= ? ORDER BY created_at",
        (metric, cutoff),
    ).fetchall()

    result: dict[str, list] = defaultdict(list)
    for r in rows:
        result[r["gpu_key"]].append({"timestamp": r["timestamp"], "value": r["value"]})
    return dict(result)


# ---------------------------------------------------------------------------
# Alert rules persistence
# ---------------------------------------------------------------------------

def load_alert_rules() -> list[dict]:
    db = _get_db()
    rows = db.execute("SELECT * FROM alert_rules ORDER BY created_at").fetchall()
    return [dict(r) for r in rows]


def save_alert_rule(rule: dict) -> bool:
    try:
        db = _get_db()
        db.execute(
            "INSERT OR REPLACE INTO alert_rules "
            "(id, name, metric, threshold, comparison, gpu_filter, host_filter, "
            " enabled, cooldown_seconds, notify_webhook, notify_email, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (rule["id"], rule["name"], rule["metric"], rule["threshold"],
             rule["comparison"], rule.get("gpu_filter", "*"),
             rule.get("host_filter", "*"), int(rule.get("enabled", True)),
             rule.get("cooldown_seconds", 300),
             int(rule.get("notify_webhook", False)),
             int(rule.get("notify_email", False)),
             rule["created_at"], rule["updated_at"]),
        )
        db.commit()
        return True
    except Exception:
        return False


def delete_alert_rule(rule_id: str) -> bool:
    db = _get_db()
    cur = db.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
    db.commit()
    return cur.rowcount > 0


def save_alert_event(event: dict):
    try:
        db = _get_db()
        db.execute(
            "INSERT INTO alert_events "
            "(rule_id, rule_name, metric, value, threshold, gpu_id, host, "
            " message, severity, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (event["rule_id"], event["rule_name"], event["metric"],
             event["value"], event["threshold"], event.get("gpu_id"),
             event.get("host"), event["message"], event.get("severity", "warning"),
             event["created_at"]),
        )
        db.commit()
    except Exception:
        pass


def load_alert_events(limit: int = 200) -> list[dict]:
    db = _get_db()
    rows = db.execute(
        "SELECT * FROM alert_events ORDER BY created_at DESC LIMIT ?", (limit,)
    ).fetchall()
    return [dict(r) for r in rows]


def acknowledge_alert(event_id: int) -> bool:
    db = _get_db()
    cur = db.execute(
        "UPDATE alert_events SET acknowledged = 1 WHERE id = ?", (event_id,)
    )
    db.commit()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Token statistics persistence
# ---------------------------------------------------------------------------

def record_token_snapshot(model: str, prompt_tokens: int, generated_tokens: int,
                          request_count: int, tpt_sum: float, tpt_count: int,
                          req_dur_sum: float):
    """Store a point-in-time snapshot of Ollama Prometheus counters."""
    try:
        db = _get_db()
        db.execute(
            "INSERT INTO token_snapshots "
            "(timestamp, model, prompt_tokens, generated_tokens, request_count, "
            " time_per_token_sum, time_per_token_count, request_duration_sum) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (time.time(), model, prompt_tokens, generated_tokens,
             request_count, tpt_sum, tpt_count, req_dur_sum),
        )
        db.commit()
    except Exception:
        pass


def get_token_stats(hours: int = 24) -> dict:
    """Return aggregated token statistics for the given window."""
    cutoff = time.time() - hours * 3600
    db = _get_db()

    # -- per-model totals (latest snapshot minus earliest in window) --------
    models_raw = db.execute(
        "SELECT model, "
        "  MIN(generated_tokens) AS gen_min, MAX(generated_tokens) AS gen_max, "
        "  MIN(prompt_tokens) AS pt_min,  MAX(prompt_tokens) AS pt_max, "
        "  MIN(request_count) AS rc_min,  MAX(request_count) AS rc_max, "
        "  MIN(request_duration_sum) AS rd_min, MAX(request_duration_sum) AS rd_max, "
        "  MAX(time_per_token_count) AS tpt_cnt, "
        "  MAX(time_per_token_sum) AS tpt_sum "
        "FROM token_snapshots WHERE timestamp >= ? "
        "GROUP BY model",
        (cutoff,),
    ).fetchall()

    models = {}
    total_generated = 0
    total_prompt = 0
    total_requests = 0
    total_duration = 0.0
    for r in models_raw:
        gen = max(r["gen_max"] - r["gen_min"], 0)
        pt = max(r["pt_max"] - r["pt_min"], 0)
        rc = max(r["rc_max"] - r["rc_min"], 0)
        dur = max(r["rd_max"] - r["rd_min"], 0.0)
        avg_tpt = (r["tpt_sum"] / r["tpt_cnt"]) if r["tpt_cnt"] else 0
        tps = (1.0 / avg_tpt) if avg_tpt > 0 else 0
        models[r["model"]] = {
            "generated_tokens": gen,
            "prompt_tokens": pt,
            "requests": rc,
            "total_duration_sec": round(dur, 1),
            "avg_tokens_per_sec": round(tps, 1),
        }
        total_generated += gen
        total_prompt += pt
        total_requests += rc
        total_duration += dur

    # -- time-series (5-min buckets) ----------------------------------------
    bucket_sec = 300
    rows = db.execute(
        "SELECT timestamp, model, generated_tokens, prompt_tokens "
        "FROM token_snapshots WHERE timestamp >= ? ORDER BY timestamp",
        (cutoff,),
    ).fetchall()

    # Build per-model cumulative series, then diff for buckets
    from collections import defaultdict as _dd
    series_by_model: dict[str, list] = _dd(list)
    for r in rows:
        series_by_model[r["model"]].append(
            (r["timestamp"], r["generated_tokens"], r["prompt_tokens"])
        )

    # Merge into unified time buckets
    bucket_map: dict[int, dict] = {}
    for model, pts in series_by_model.items():
        prev_gen = pts[0][1] if pts else 0
        prev_pt = pts[0][2] if pts else 0
        for ts, gen, pt in pts[1:]:
            bk = int(ts // bucket_sec) * bucket_sec
            if bk not in bucket_map:
                bucket_map[bk] = {"generated": 0, "prompt": 0}
            bucket_map[bk]["generated"] += max(gen - prev_gen, 0)
            bucket_map[bk]["prompt"] += max(pt - prev_pt, 0)
            prev_gen, prev_pt = gen, pt

    history = []
    for bk in sorted(bucket_map):
        d = bucket_map[bk]
        history.append({
            "time": datetime.utcfromtimestamp(bk).isoformat() + "Z",
            "generated": d["generated"],
            "prompt": d["prompt"],
            "total": d["generated"] + d["prompt"],
        })

    # -- current rate (last 2 snapshots per model) --------------------------
    current_tps = 0.0
    for model in series_by_model:
        pts = series_by_model[model]
        if len(pts) >= 2:
            dt = pts[-1][0] - pts[-2][0]
            dg = pts[-1][1] - pts[-2][1]
            if dt > 0 and dg > 0:
                current_tps += dg / dt

    return {
        "summary": {
            "total_generated": total_generated,
            "total_prompt": total_prompt,
            "total_tokens": total_generated + total_prompt,
            "total_requests": total_requests,
            "total_duration_sec": round(total_duration, 1),
            "current_tps": round(current_tps, 1),
        },
        "models": models,
        "history": history,
    }


def prune_old_token_snapshots():
    """Delete token snapshots older than retention window."""
    try:
        cutoff = time.time() - HISTORICAL_DATA_RETENTION * 3600
        db = _get_db()
        db.execute("DELETE FROM token_snapshots WHERE timestamp < ?", (cutoff,))
        db.commit()
    except Exception:
        pass
