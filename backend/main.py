from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from collections import Counter
from pydantic import ValidationError
import time

from models import (
    EventIn,
    SessionSummary,
    SessionDetail,
    SessionStats,
    EventRecord,
)
from storage import (
    init_db,
    upsert_event,
    get_session_events,
    get_all_session_ids,
    save_session_cache,
    get_session_cache,
    get_all_session_caches,
)
from detector import run_all_detectors, generate_insights

app = FastAPI(title="Agent Observability API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    init_db()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_stats(events: list[EventRecord]) -> SessionStats:
    total = len(events)
    success_count = sum(1 for e in events if e.metadata_status == "success")
    failure_count = total - success_count
    action_dist = dict(Counter(e.action for e in events))
    return SessionStats(
        total_steps=total,
        success_count=success_count,
        failure_count=failure_count,
        failure_rate=failure_count / total if total else 0.0,
        action_distribution=action_dist,
    )


def _process_session(session_id: str):
    """Recompute detection results for a session and persist to cache."""
    events = get_session_events(session_id)
    if not events:
        return

    stats = _compute_stats(events)
    status, issues = run_all_detectors(events)

    save_session_cache(
        session_id=session_id,
        status=status.value,
        stats=stats.model_dump(),
        issues=[i.model_dump() for i in issues],
        first_seen=events[0].timestamp,
        last_seen=events[-1].timestamp,
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post("/events", status_code=201)
async def ingest_event(request: Request):
    """
    Accept a single event. Handles:
    - Malformed JSON → 400
    - Missing/invalid fields → uses defaults where possible, rejects otherwise
    - Duplicate (session_id, step) → silently ignored (idempotent)
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    # Coerce metadata if it's missing or None
    if "metadata" not in body or body["metadata"] is None:
        body["metadata"] = {}

    try:
        event = EventIn(**body)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors())

    inserted = upsert_event(event)
    _process_session(event.session_id)

    return {
        "accepted": inserted,
        "duplicate": not inserted,
        "session_id": event.session_id,
        "step": event.step,
    }


@app.get("/sessions", response_model=list[SessionSummary])
def list_sessions():
    """Return all sessions with their status and key stats."""
    caches = get_all_session_caches()
    result = []
    for c in caches:
        events = get_session_events(c["session_id"])
        result.append(SessionSummary(
            session_id=c["session_id"],
            status=c["status"],
            stats=SessionStats(**c["stats"]),
            event_count=len(events),
            first_seen=c["first_seen"],
            last_seen=c["last_seen"],
            issues=c["issues"],
        ))
    return result


@app.get("/sessions/{session_id}", response_model=SessionDetail)
def get_session(session_id: str):
    """Return full event timeline, detected issues, and insights for a session."""
    events = get_session_events(session_id)
    if not events:
        raise HTTPException(status_code=404, detail="Session not found")

    cache = get_session_cache(session_id)
    if not cache:
        _process_session(session_id)
        cache = get_session_cache(session_id)

    stats = SessionStats(**cache["stats"])
    # Deserialize issue dicts back to DetectedIssue objects for the insight generator
    from models import DetectedIssue as _Issue
    issues_obj = [_Issue(**i) if isinstance(i, dict) else i for i in cache["issues"]]
    insights = generate_insights(events, issues_obj, cache["stats"])

    return SessionDetail(
        session_id=session_id,
        status=cache["status"],
        stats=stats,
        events=events,
        issues=issues_obj,
        insights=insights,
    )


@app.get("/sessions/{session_id}/insights")
def get_insights(session_id: str):
    """Return plain-language insights for a session."""
    events = get_session_events(session_id)
    if not events:
        raise HTTPException(status_code=404, detail="Session not found")

    cache = get_session_cache(session_id)
    if not cache:
        _process_session(session_id)
        cache = get_session_cache(session_id)

    _, issues = run_all_detectors(events)
    insights = generate_insights(events, issues, cache["stats"])
    return {"session_id": session_id, "insights": insights}


@app.get("/health")
def health():
    return {"status": "ok", "timestamp": time.time()}
