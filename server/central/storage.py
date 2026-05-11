"""SQLite persistence for the central backend.

Tables: users, hosts, settings.
"""

import logging
import os
import sqlite3
import threading
import time

from config import DATA_DIR

log = logging.getLogger(__name__)

os.makedirs(DATA_DIR, exist_ok=True)
_DB_PATH = os.path.join(DATA_DIR, "central.db")
_local = threading.local()


def _get_db() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(_DB_PATH, timeout=10)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA busy_timeout=5000")
        _local.conn.row_factory = sqlite3.Row
    return _local.conn


def init_db():
    db = _get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'viewer',
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS hosts (
            url TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at REAL NOT NULL
        );
    """)
    # Migrate: add `position` to hosts if missing, then seed with rowid
    # order so existing rows keep their original sequence.
    cols = {r["name"] for r in db.execute("PRAGMA table_info(hosts)")}
    if "position" not in cols:
        db.execute("ALTER TABLE hosts ADD COLUMN position INTEGER NOT NULL DEFAULT 0")
        rows = db.execute("SELECT url FROM hosts ORDER BY created_at").fetchall()
        for i, r in enumerate(rows):
            db.execute("UPDATE hosts SET position = ? WHERE url = ?", (i, r["url"]))
    db.commit()


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def get_user(username: str) -> dict | None:
    db = _get_db()
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    return dict(row) if row else None


def count_users() -> int:
    db = _get_db()
    return db.execute("SELECT COUNT(*) FROM users").fetchone()[0]


def create_user(username: str, password_hash: str, role: str = "admin") -> bool:
    try:
        db = _get_db()
        now = time.time()
        db.execute(
            "INSERT INTO users (username, password_hash, role, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (username, password_hash, role, now, now),
        )
        db.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    except Exception:
        log.exception("Failed to create user")
        return False


def update_password(username: str, password_hash: str) -> bool:
    db = _get_db()
    cur = db.execute(
        "UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?",
        (password_hash, time.time(), username),
    )
    db.commit()
    return cur.rowcount > 0


# ---------------------------------------------------------------------------
# Hosts
# ---------------------------------------------------------------------------

def load_hosts() -> list[dict]:
    db = _get_db()
    rows = db.execute(
        "SELECT url, name, created_at FROM hosts ORDER BY position, created_at"
    ).fetchall()
    return [dict(r) for r in rows]


def save_host(url: str, name: str, created_at: str) -> bool:
    try:
        db = _get_db()
        # Append new hosts to the end of the ordering.
        max_pos = db.execute("SELECT COALESCE(MAX(position), -1) FROM hosts").fetchone()[0]
        db.execute(
            "INSERT OR IGNORE INTO hosts (url, name, created_at, position) "
            "VALUES (?, ?, ?, ?)",
            (url, name, created_at, max_pos + 1),
        )
        db.commit()
        return True
    except Exception:
        log.exception("Failed to save host")
        return False


def reorder_hosts(urls: list[str]) -> bool:
    """Persist a new host ordering.  ``urls`` must be a permutation of
    the currently-stored host URLs; any extras/missing are rejected.
    Returns True on success."""
    try:
        db = _get_db()
        current = {r["url"] for r in db.execute("SELECT url FROM hosts")}
        if set(urls) != current:
            log.warning("reorder_hosts: %d urls submitted, %d in DB (mismatch)",
                        len(urls), len(current))
            return False
        with db:
            for i, url in enumerate(urls):
                db.execute("UPDATE hosts SET position = ? WHERE url = ?", (i, url))
        return True
    except Exception:
        log.exception("Failed to reorder hosts")
        return False


def delete_host(url: str) -> bool:
    db = _get_db()
    cur = db.execute("DELETE FROM hosts WHERE url = ?", (url,))
    db.commit()
    return cur.rowcount > 0


def update_host(url: str, name: str) -> bool:
    """Rename a host.  Returns True iff a row was updated."""
    try:
        db = _get_db()
        cur = db.execute("UPDATE hosts SET name = ? WHERE url = ?", (name, url))
        db.commit()
        return cur.rowcount > 0
    except Exception:
        log.exception("Failed to update host")
        return False


# ---------------------------------------------------------------------------
# Settings (key-value)
# ---------------------------------------------------------------------------

def get_setting(key: str, default: str | None = None) -> str | None:
    db = _get_db()
    row = db.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> bool:
    try:
        db = _get_db()
        db.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, time.time()),
        )
        db.commit()
        return True
    except Exception:
        log.exception("Failed to set setting")
        return False


def get_all_settings() -> dict:
    db = _get_db()
    rows = db.execute("SELECT key, value FROM settings").fetchall()
    return {r["key"]: r["value"] for r in rows}


def delete_setting(key: str) -> bool:
    db = _get_db()
    cur = db.execute("DELETE FROM settings WHERE key = ?", (key,))
    db.commit()
    return cur.rowcount > 0
