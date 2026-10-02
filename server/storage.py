"""
Centralized data storage.

Provides thread-safe in-memory storage with optional SQLite persistence
so that historical data survives backend restarts.
"""

import json
import logging
import os
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from contextlib import contextmanager

from config import DATA_DIR, HISTORICAL_DATA_RETENTION

log = logging.getLogger(__name__)

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


def _close_db():
    """Close the thread-local connection so the next _get_db() reconnects."""
    conn = getattr(_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
        _local.conn = None


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

        CREATE TABLE IF NOT EXISTS benchmark_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT NOT NULL,
            runtime TEXT NOT NULL,
            prompt TEXT NOT NULL,
            prompt_tokens INTEGER NOT NULL DEFAULT 0,
            generated_tokens INTEGER NOT NULL DEFAULT 0,
            tokens_per_second REAL NOT NULL DEFAULT 0,
            time_to_first_token_ms REAL,
            total_duration_ms REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'completed',
            error TEXT,
            metadata TEXT,
            created_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bench_model
            ON benchmark_results(model, created_at);
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
        log.debug("Failed to record gpu_history sample", exc_info=True)


def prune_old_history():
    """Delete samples older than retention window and reclaim disk space."""
    try:
        cutoff = time.time() - HISTORICAL_DATA_RETENTION * 3600
        db = _get_db()
        cur = db.execute("DELETE FROM gpu_history WHERE created_at < ?", (cutoff,))
        db.commit()
        deleted = cur.rowcount
        if deleted > 0:
            log.info("Pruned %d old gpu_history rows", deleted)
            # Checkpoint WAL to free disk space
            db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception:
        log.debug("Failed to prune gpu_history", exc_info=True)
        _close_db()


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
        log.debug("Failed to record alert event", exc_info=True)


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
    except sqlite3.OperationalError:
        log.exception("Failed to record token snapshot for model=%s (recycling connection)", model)
        _close_db()
    except Exception:
        log.exception("Failed to record token snapshot for model=%s", model)


def get_token_stats(hours: int = 24) -> dict:
    """Return aggregated token statistics for the given window.

    Notes on correctness:
      * Window deltas are computed as a **pairwise sum** across the
        time-series snapshots — for every consecutive pair we add
        ``max(curr - prev, 0)`` and treat ``curr < prev`` as a counter
        reset (server restart) by attributing only ``curr`` to that
        interval.  This is reset-safe; MAX-MIN is not (a restart mid-
        window inflates the windowed delta by the entire pre-restart
        history).  Cumulative fields use the same reset-safe pairwise
        accounting across all retained snapshots.
      * History buckets are zero-filled across the full window so the
        x-axis is continuous (chart doesn't bunch up around activity).
      * `current_tps` is averaged over the last 5 minutes rather than
        the last single inter-snapshot delta, so it's stable even when
        scrapes are out-of-phase with inference bursts.
      * `avg_tokens_per_sec` per model is the windowed TPT delta
        (Δsum / Δcount) — not the all-time cumulative ratio.
    """
    window_sec = hours * 3600
    now = time.time()
    cutoff = now - window_sec
    db = _get_db()

    # Adaptive bucket size: aim for ~60-120 buckets across the window.
    # Round to a "nice" interval to keep timestamps aligned.
    target_buckets = 90
    raw_bucket = max(60, window_sec // target_buckets)
    nice_steps = (60, 120, 300, 600, 900, 1800, 3600, 7200)
    bucket_sec = nice_steps[-1]
    for s in nice_steps:
        if s >= raw_bucket:
            bucket_sec = s
            break

    # -- per-model totals & windowed avg_tokens_per_sec --------------------
    models_raw = db.execute(
        "SELECT DISTINCT model FROM token_snapshots"
    ).fetchall()

    # Pairwise per-model deltas — reset-safe (see docstring).  Computed
    # in a single pass over the time-series so we don't need a second
    # SQL trip.  Same bound on per-interval delta as the chart loop.
    _per_model_rows = db.execute(
        "SELECT timestamp, model, generated_tokens, prompt_tokens, request_count, "
        "       request_duration_sum, time_per_token_sum, time_per_token_count "
        "FROM token_snapshots WHERE timestamp >= ? OR id IN ("
        "  SELECT MAX(id) FROM token_snapshots WHERE timestamp < ? GROUP BY model"
        ") ORDER BY model, timestamp",
        (cutoff, cutoff),
    ).fetchall()
    # Per-interval cap: anything bigger is almost certainly a corrupt
    # snapshot (not a counter reset — those are detected by the
    # `curr < prev` branch above and credited as `curr`).  10 M tokens
    # between two scrapes corresponds to ~166 k tok/s sustained across
    # a 60 s scrape gap, comfortably above realistic single-host vLLM
    # throughput.  The old 500 k cap was silently dropping legitimate
    # bursts on heavily-loaded servers.
    _max_delta = 10_000_000
    _pairwise: dict[str, dict] = {}
    _prev_by_model: dict[str, tuple] = {}
    for r in _per_model_rows:
        m = r["model"]
        cur = (r["generated_tokens"], r["prompt_tokens"], r["request_count"],
               r["request_duration_sum"], r["time_per_token_sum"],
               r["time_per_token_count"])
        prev = _prev_by_model.get(m)
        if prev is not None and r["timestamp"] >= cutoff:
            dg = cur[0] - prev[0] if cur[0] >= prev[0] else cur[0]
            dp = cur[1] - prev[1] if cur[1] >= prev[1] else cur[1]
            dr = cur[2] - prev[2] if cur[2] >= prev[2] else cur[2]
            dd = cur[3] - prev[3] if cur[3] >= prev[3] else cur[3]
            ds = cur[4] - prev[4] if cur[4] >= prev[4] else cur[4]
            dc = cur[5] - prev[5] if cur[5] >= prev[5] else cur[5]
            if dg <= _max_delta and dp <= _max_delta:
                acc = _pairwise.setdefault(m, {"g": 0, "p": 0, "r": 0, "d": 0.0, "ts": 0.0, "tc": 0})
                acc["g"] += dg
                acc["p"] += dp
                acc["r"] += dr
                acc["d"] += dd
                acc["ts"] += ds
                acc["tc"] += dc
        _prev_by_model[m] = cur

    all_rows = db.execute(
        "SELECT model, generated_tokens, prompt_tokens, request_count "
        "FROM token_snapshots ORDER BY model, timestamp"
    ).fetchall()
    cumulative_by_model: dict[str, dict[str, int]] = {}
    cumulative_previous: dict[str, tuple[int, int, int]] = {}
    for row in all_rows:
        model = row["model"]
        current = (row["generated_tokens"], row["prompt_tokens"], row["request_count"])
        previous = cumulative_previous.get(model)
        totals = cumulative_by_model.setdefault(model, {"g": 0, "p": 0, "r": 0})
        if previous is None:
            totals["g"] += current[0]
            totals["p"] += current[1]
            totals["r"] += current[2]
        else:
            totals["g"] += current[0] - previous[0] if current[0] >= previous[0] else current[0]
            totals["p"] += current[1] - previous[1] if current[1] >= previous[1] else current[1]
            totals["r"] += current[2] - previous[2] if current[2] >= previous[2] else current[2]
        cumulative_previous[model] = current

    models = {}
    total_generated = 0
    total_prompt = 0
    total_requests = 0
    total_duration = 0.0
    cumulative_generated = 0
    cumulative_prompt = 0
    cumulative_requests = 0
    for r in models_raw:
        acc = _pairwise.get(r["model"], {"g": 0, "p": 0, "r": 0, "d": 0.0, "ts": 0.0, "tc": 0})
        cumulative = cumulative_by_model.get(r["model"], {"g": 0, "p": 0, "r": 0})
        gen = acc["g"]
        pt = acc["p"]
        rc = acc["r"]
        dur = acc["d"]
        if acc["tc"] > 0 and acc["ts"] > 0:
            avg_tpt = acc["ts"] / acc["tc"]
            tps = 1.0 / avg_tpt if avg_tpt > 0 else 0
        elif gen > 0 and dur > 0:
            tps = gen / dur
        else:
            tps = 0
        models[r["model"]] = {
            "generated_tokens": gen,
            "prompt_tokens": pt,
            "requests": rc,
            "total_duration_sec": round(dur, 1),
            "avg_tokens_per_sec": round(tps, 1),
            "avg_latency_sec": round(dur / rc, 3) if rc > 0 else 0,
            "avg_prompt_tokens": round(pt / rc, 1) if rc > 0 else 0,
            "avg_generated_tokens": round(gen / rc, 1) if rc > 0 else 0,
            "cumulative_generated": cumulative["g"],
            "cumulative_prompt": cumulative["p"],
            "cumulative_requests": cumulative["r"],
        }
        total_generated += gen
        total_prompt += pt
        total_requests += rc
        total_duration += dur
        cumulative_generated += cumulative["g"]
        cumulative_prompt += cumulative["p"]
        cumulative_requests += cumulative["r"]

    # -- time-series ------------------------------------------------------
    rows = db.execute(
        "SELECT timestamp, model, generated_tokens, prompt_tokens "
        "FROM token_snapshots WHERE timestamp >= ? OR id IN ("
        "  SELECT MAX(id) FROM token_snapshots WHERE timestamp < ? GROUP BY model"
        ") ORDER BY timestamp",
        (cutoff, cutoff),
    ).fetchall()

    from collections import defaultdict as _dd
    series_by_model: dict[str, list] = _dd(list)
    for r in rows:
        series_by_model[r["model"]].append(
            (r["timestamp"], r["generated_tokens"], r["prompt_tokens"])
        )

    bucket_map: dict[int, dict] = {}
    # Allow 4× bucket size as a gap before skipping a delta — anything
    # bigger is likely a scraper outage and shouldn't be attributed to
    # the next bucket. max_delta_per_interval (below) is a separate
    # protection against bad counter values.
    gap_threshold = bucket_sec * 4
    max_delta_per_interval = 10_000_000  # see notes on _max_delta above
    for model, pts in series_by_model.items():
        if not pts:
            continue
        prev_ts, prev_gen, prev_pt = pts[0]
        for ts, gen, pt in pts[1:]:
            bk = int(ts // bucket_sec) * bucket_sec
            bucket_map.setdefault(bk, {"generated": 0, "prompt": 0})
            if ts - prev_ts > gap_threshold:
                prev_ts, prev_gen, prev_pt = ts, gen, pt
                continue
            dg = gen - prev_gen if gen >= prev_gen else gen
            dp = pt - prev_pt if pt >= prev_pt else pt
            if dg > max_delta_per_interval or dp > max_delta_per_interval:
                prev_ts, prev_gen, prev_pt = ts, gen, pt
                continue
            bucket_map[bk]["generated"] += dg
            bucket_map[bk]["prompt"] += dp
            prev_ts, prev_gen, prev_pt = ts, gen, pt

    # Zero-fill: emit one bucket every `bucket_sec` across the full
    # window so the chart x-axis is continuous and consistent across
    # window-size changes.
    first_bk = int(cutoff // bucket_sec) * bucket_sec
    last_bk = int(now // bucket_sec) * bucket_sec
    history = []
    bk = first_bk
    while bk <= last_bk:
        d = bucket_map.get(bk, {"generated": 0, "prompt": 0})
        history.append({
            "time": datetime.fromtimestamp(bk, timezone.utc).isoformat().replace("+00:00", "Z"),
            "generated": d["generated"],
            "prompt": d["prompt"],
            "total": d["generated"] + d["prompt"],
        })
        bk += bucket_sec

    # -- current rate: rolling 5-minute average ---------------------------
    rate_window = 300  # 5 min
    rate_cutoff = now - rate_window
    current_tps = 0.0
    for model, pts in series_by_model.items():
        recent = [p for p in pts if p[0] >= rate_cutoff]
        if len(recent) >= 2:
            dt = recent[-1][0] - recent[0][0]
            # Account for resets within the window
            dg = 0
            prev = recent[0][1]
            for _ts, g, _p in recent[1:]:
                if g >= prev:
                    dg += g - prev
                else:
                    dg += g
                prev = g
            if dt > 0 and dg > 0:
                current_tps += dg / dt

    active_window_sec = min(window_sec, max(0.0, now - rows[0]["timestamp"])) if rows else window_sec
    peak_generation_tps = max((point["generated"] / bucket_sec for point in history), default=0.0)
    average_latency = total_duration / total_requests if total_requests > 0 else 0.0
    tokens_per_request = (total_generated + total_prompt) / total_requests if total_requests > 0 else 0.0

    return {
        "summary": {
            "total_generated": total_generated,
            "total_prompt": total_prompt,
            "total_tokens": total_generated + total_prompt,
            "total_requests": total_requests,
            "total_duration_sec": round(total_duration, 1),
            "current_tps": round(current_tps, 1),
            "peak_generation_tps": round(peak_generation_tps, 1),
            "requests_per_minute": round(total_requests / (active_window_sec / 60), 2) if active_window_sec > 0 else 0,
            "avg_request_latency_sec": round(average_latency, 3),
            "avg_tokens_per_request": round(tokens_per_request, 1),
            "prompt_to_generated_ratio": round(total_prompt / total_generated, 3) if total_generated > 0 else 0,
            "cumulative_generated": cumulative_generated,
            "cumulative_prompt": cumulative_prompt,
            "cumulative_tokens": cumulative_generated + cumulative_prompt,
            "cumulative_requests": cumulative_requests,
            "bucket_sec": bucket_sec,
        },
        "models": models,
        "history": history,
    }


def prune_old_token_snapshots():
    """Delete token snapshots older than retention window and reclaim disk space."""
    try:
        cutoff = time.time() - HISTORICAL_DATA_RETENTION * 3600
        db = _get_db()
        cur = db.execute("DELETE FROM token_snapshots WHERE timestamp < ?", (cutoff,))
        db.commit()
        deleted = cur.rowcount
        if deleted > 0:
            log.info("Pruned %d old token_snapshots rows", deleted)
            # Checkpoint WAL to free disk space
            db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception:
        log.debug("Failed to prune token_snapshots", exc_info=True)
        _close_db()


# ---------------------------------------------------------------------------
# Benchmark results
# ---------------------------------------------------------------------------

def save_benchmark_result(result: dict) -> int | None:
    """Persist a benchmark result and return its id."""
    try:
        db = _get_db()
        cur = db.execute(
            """INSERT INTO benchmark_results
               (model, runtime, prompt, prompt_tokens, generated_tokens,
                tokens_per_second, time_to_first_token_ms, total_duration_ms,
                status, error, metadata, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                result["model"],
                result["runtime"],
                result["prompt"],
                result.get("prompt_tokens", 0),
                result.get("generated_tokens", 0),
                result.get("tokens_per_second", 0),
                result.get("time_to_first_token_ms"),
                result.get("total_duration_ms", 0),
                result.get("status", "completed"),
                result.get("error"),
                json.dumps(result.get("metadata", {})),
                time.time(),
            ),
        )
        db.commit()
        return cur.lastrowid
    except Exception:
        log.exception("Failed to save benchmark result")
        return None


def get_benchmark_results(model: str | None = None, limit: int = 50) -> list[dict]:
    """Return recent benchmark results, optionally filtered by model."""
    try:
        db = _get_db()
        if model:
            rows = db.execute(
                "SELECT * FROM benchmark_results WHERE model = ? ORDER BY created_at DESC LIMIT ?",
                (model, limit),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM benchmark_results ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            if d.get("metadata"):
                try:
                    d["metadata"] = json.loads(d["metadata"])
                except (json.JSONDecodeError, TypeError):
                    pass
            results.append(d)
        return results
    except Exception:
        log.exception("Failed to load benchmark results")
        return []
