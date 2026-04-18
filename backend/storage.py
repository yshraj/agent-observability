import sqlite3
import time
import json
import threading
from contextlib import contextmanager
from typing import Optional
from models import EventIn, EventRecord

DB_PATH = "agent_events.db"

_local = threading.local()


def get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA synchronous=NORMAL")
    return _local.conn


@contextmanager
def transaction():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def init_db():
    with transaction() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS events (
                session_id    TEXT NOT NULL,
                step          INTEGER NOT NULL,
                timestamp     REAL NOT NULL,
                action        TEXT NOT NULL,
                input         TEXT NOT NULL DEFAULT '',
                output        TEXT NOT NULL DEFAULT '',
                metadata_file TEXT,
                metadata_status TEXT NOT NULL DEFAULT 'success',
                received_at   REAL NOT NULL,
                PRIMARY KEY (session_id, step)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_events_session
            ON events(session_id, step ASC)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS session_cache (
                session_id   TEXT PRIMARY KEY,
                status       TEXT NOT NULL DEFAULT 'healthy',
                stats_json   TEXT NOT NULL DEFAULT '{}',
                issues_json  TEXT NOT NULL DEFAULT '[]',
                first_seen   REAL NOT NULL,
                last_seen    REAL NOT NULL
            )
        """)


def upsert_event(event: EventIn) -> bool:
    """Insert event; returns True if inserted, False if duplicate (ignored)."""
    received_at = time.time()
    with transaction() as conn:
        cur = conn.execute("""
            INSERT OR IGNORE INTO events
              (session_id, step, timestamp, action, input, output,
               metadata_file, metadata_status, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            event.session_id,
            event.step,
            event.timestamp,
            event.action.value,
            event.input,
            event.output,
            event.metadata.file,
            event.metadata.status.value,
            received_at,
        ))
        return cur.rowcount > 0


def get_session_events(session_id: str) -> list[EventRecord]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT * FROM events
        WHERE session_id = ?
        ORDER BY step ASC
    """, (session_id,)).fetchall()
    return [EventRecord(**dict(r)) for r in rows]


def get_all_session_ids() -> list[str]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT DISTINCT session_id FROM events
        ORDER BY MIN(received_at) DESC
    """).fetchall()
    return [r["session_id"] for r in rows]


def save_session_cache(session_id: str, status: str, stats: dict,
                       issues: list, first_seen: float, last_seen: float):
    with transaction() as conn:
        conn.execute("""
            INSERT INTO session_cache
              (session_id, status, stats_json, issues_json, first_seen, last_seen)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              status     = excluded.status,
              stats_json = excluded.stats_json,
              issues_json = excluded.issues_json,
              first_seen = excluded.first_seen,
              last_seen  = excluded.last_seen
        """, (
            session_id,
            status,
            json.dumps(stats),
            json.dumps(issues),
            first_seen,
            last_seen,
        ))


def get_session_cache(session_id: str) -> Optional[dict]:
    conn = get_conn()
    row = conn.execute("""
        SELECT * FROM session_cache WHERE session_id = ?
    """, (session_id,)).fetchone()
    if not row:
        return None
    return {
        "session_id": row["session_id"],
        "status": row["status"],
        "stats": json.loads(row["stats_json"]),
        "issues": json.loads(row["issues_json"]),
        "first_seen": row["first_seen"],
        "last_seen": row["last_seen"],
    }


def get_all_session_caches() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("""
        SELECT sc.* FROM session_cache sc
        JOIN (
            SELECT session_id, MIN(received_at) as first_recv
            FROM events GROUP BY session_id
        ) e ON sc.session_id = e.session_id
        ORDER BY e.first_recv DESC
    """).fetchall()
    return [{
        "session_id": r["session_id"],
        "status": r["status"],
        "stats": json.loads(r["stats_json"]),
        "issues": json.loads(r["issues_json"]),
        "first_seen": r["first_seen"],
        "last_seen": r["last_seen"],
    } for r in rows]
