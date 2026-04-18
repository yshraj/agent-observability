# Agent Observability

A monitoring system for AI agents that ingests real-world event streams, detects behavioral issues (loops, drift, failures), and surfaces insights via a live UI.

---

## Table of Contents

1. [What This System Does](#what-this-system-does)
2. [Project Structure](#project-structure)
3. [Setup Instructions (Windows)](#setup-instructions-windows)
4. [Running the Simulator](#running-the-simulator)
5. [Architecture Overview](#architecture-overview)
6. [Per-Session Metrics](#per-session-metrics)
7. [Detection Logic](#detection-logic)
8. [Edge Case Handling](#edge-case-handling)
9. [API Reference](#api-reference)
10. [Design Decisions & Trade-offs](#design-decisions--trade-offs)

---

## What This System Does

An AI agent running in a development environment generates a stream of events: reading files, writing files, calling LLMs, running commands. These agents are often unreliable — they repeat steps, change direction mid-task, or fail silently.

This system:
- **Ingests** those events via a REST API (handles duplicates, out-of-order arrival, missing fields, bursts)
- **Detects** loops, drift, and failure patterns using practical heuristics (not naive string matching)
- **Surfaces** per-session insights in a live-updating UI

---

## Project Structure

```
agent-observability/
├── backend/
│   ├── main.py           FastAPI app — routes, request handling
│   ├── models.py         Pydantic schemas for events, sessions, issues
│   ├── storage.py        SQLite layer (WAL mode, dedup, caching)
│   ├── detector.py       Loop / Drift / Failure detection engine
│   └── requirements.txt
├── simulator/
│   └── agent.py          CLI — 4 scenarios: normal, loop, drift, failure
├── frontend/
│   ├── app/
│   │   ├── page.tsx                  Session list (auto-refreshes every 3s)
│   │   └── sessions/[id]/page.tsx    Session detail — timeline + issues + insights
│   ├── components/
│   │   ├── StatusBadge.tsx
│   │   └── ActionBadge.tsx
│   └── lib/api.ts         Typed API client
└── README.md
```

---

## Setup Instructions (Windows)

### Prerequisites

- Python 3.10 or higher — https://python.org/downloads
- Node.js 18 or higher — https://nodejs.org

### 1. Backend

Open **Command Prompt** or **PowerShell** in the project folder:

```cmd
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API starts at `http://localhost:8000`.
You can verify it with: `curl http://localhost:8000/health`

### 2. Frontend

Open a **second terminal** window:

```cmd
cd frontend
npm install
npm run dev
```

The UI opens at `http://localhost:3000`.

> If port 3000 is busy, Next.js will try 3001 automatically. Check the terminal output.

### 3. Simulator (runs in a third terminal)

```cmd
cd simulator
pip install requests
```

Then run any scenario (see next section).

### Stopping the servers

**Command Prompt:**
```cmd
Ctrl+C
```

**To kill a specific port (if Ctrl+C doesn't work):**
```cmd
netstat -ano | findstr :8000
taskkill /PID <PID_NUMBER> /F
```

---

## Running the Simulator

```cmd
cd simulator

:: Single scenarios
python agent.py --scenario normal
python agent.py --scenario loop
python agent.py --scenario drift
python agent.py --scenario failure

:: All 4 scenarios at once — events interleave across sessions
python agent.py --scenario all

:: Custom options
python agent.py --scenario loop --session-id my-test-1 --delay 0.05
python agent.py --scenario drift --api http://localhost:8000
```

### Scenario Descriptions

| Scenario | What it simulates | Expected detection |
|---|---|---|
| `normal` | Logical progression: read → analyze → write → test → repeat | **Healthy** |
| `loop` | Agent stuck retrying the same lint fix with slight variations | **Looping** |
| `drift` | Starts as a docs task, silently pivots to running DB migrations | **Drifting** |
| `failure` | Deploy repeatedly fails; LLM recovery suggestions don't help | **Failing** |
| `all` | All 4 run concurrently — tests mixed/interleaved session handling | All 4 statuses |
| `edge-cases` | Duplicate events + out-of-order steps — tests ingestion robustness | Healthy |

**Important design choices in the simulator:**
- Loops use **slightly different** inputs each iteration (varying filenames, line numbers, error messages) — not exact copies
- Drift is **not telegraphed** — the agent silently changes behavior mid-session
- Multiple sessions can run concurrently and their events naturally interleave

---

## Architecture Overview

```
[Python CLI Simulator]
        |  POST /events (HTTP)
        v
[FastAPI Backend]
 |-- models.py      Pydantic schemas with defaults for missing fields
 |-- storage.py     SQLite (WAL mode) — dedup via UNIQUE(session_id, step)
 |-- detector.py    Loop + Drift + Failure detection
 `-- main.py        Routes: /events, /sessions, /sessions/{id}
        |
        v
[SQLite: agent_events.db]
        |
        v
[Next.js Frontend]  <-- polls GET /sessions every 3s
 |-- /              Session list with status badges + key stats
 `-- /sessions/[id] Event timeline, detected issues, insights
```

### Data Flow

1. Simulator sends `POST /events` with an `EventIn` payload
2. Backend validates with Pydantic — missing fields get safe defaults
3. `INSERT OR IGNORE` on `(session_id, step)` — duplicates silently dropped
4. Detection engine re-runs for that session (on every accepted event)
5. Results stored in `session_cache` table
6. Frontend polls `/sessions` and `/sessions/{id}` — no page refresh needed

---

## Per-Session Metrics

Computed and stored for every session after each new event:

| Metric | Description |
|---|---|
| `total_steps` | Count of unique steps received |
| `success_count` | Steps where `metadata.status == "success"` |
| `failure_count` | Steps where `metadata.status == "failure"` |
| `failure_rate` | `failure_count / total_steps` |
| `action_distribution` | Count of each action type (`read_file`, `write_file`, `run_command`, `llm_call`) |

These are displayed in the frontend and used as inputs for the detection algorithms.

---

## Detection Logic

### Overall Status Priority

A session can trigger multiple detectors. Priority order:

```
failing  >  looping  >  drifting  >  healthy
```

Failure is most urgent. All active issues are shown in the UI regardless of priority.

---

### Loop Detection

**Algorithm:** Sliding window + fuzzy similarity clustering

```
For each window of 8 consecutive events:
  Group by action type
  For each group with >= 3 events:
    Compute pairwise Jaccard similarity on tokenized input text
    If >= 3 events have similarity >= 0.60 → flag as loop
```

**Why Jaccard instead of exact string matching?**

The spec states loops are "not exact duplicates every time." An agent retrying a lint fix might change the filename, line number, or flag — exact matching would miss this. Jaccard similarity on token sets (`{"pylint", "src", "utils.py"}`) is robust to these variations.

**Threshold reasoning:**

| Parameter | Value | Why |
|---|---|---|
| Similarity threshold | 0.60 | Below 0.60 → false positives from legitimate repeated reads. Above 0.75 → misses the fuzzy loops in the simulator |
| Window size | 8 | Small enough to stay local, large enough to catch loops that repeat every 2-3 steps |
| Min repeats | 3 | 2 similar actions could be coincidence; 3 is a pattern |

**Severity:** `high` if average pairwise similarity > 0.85 (near-exact loop), `medium` otherwise.

---

### Drift Detection

**Algorithm:** Action distribution shift between session halves

```
Split events at midpoint (by step order)
Compute action-type distribution for each half:
  e.g. first half: {read_file: 60%, llm_call: 40%}
       second half: {run_command: 70%, write_file: 30%}

Compute Total Variation Distance (TVD):
  TVD = 0.5 * sum(|p(x) - q(x)|) for all action types

If TVD >= 0.40 → flag as drift
If dominant action type flipped between halves → severity = high
```

**Why TVD?**

TVD is a principled statistical measure of how different two probability distributions are. It ranges from 0 (identical) to 1 (completely disjoint).

- A naive rule like "if action type changed" would flag any session that uses more than one action type
- TVD requires a *sustained, significant* shift in behavior — transient changes don't move the distribution enough
- A TVD of 0.40 means roughly 40% of the probability mass has moved — that's a meaningful change in what the agent is doing

**Why split at the midpoint?**

The drift scenario has a deliberate phase transition at roughly the halfway point (docs work → migration work). The midpoint split cleanly captures this. A more production-ready approach would use change-point detection (e.g., CUSUM) to find the actual transition point.

**Minimum 6 events:** Distributions computed from 2-3 events have high variance — a session that does `read_file` then `llm_call` isn't drifting, it's just getting started.

---

### Failure Detection

Two independent signals — either is sufficient to flag the session:

**Signal 1: Consecutive failures**

```
Scan events in step order
Track current failure streak
If streak >= 3 → flag as failing
  severity = medium (streak 3-4), high (streak >= 5)
```

**Signal 2: Abnormal failure rate**

```
If failure_rate >= 50% AND total_events >= 6 → flag as failing
  severity = medium (50-74%), high (>= 75%)
```

**Why both signals?**

| Pattern | Signal 1 | Signal 2 |
|---|---|---|
| 3 failures in a row, then recovers | Catches it | May not (overall rate could be low) |
| Scattered failures throughout | May not (no long streak) | Catches it |
| Both in same session | Both fire | Both fire |

**Why streak >= 3?** One or two failures are normal transient errors. Three consecutive failures strongly suggests the agent is stuck — it tried something, failed, tried again, failed, tried again, failed. That's a retry loop.

**Why rate >= 50%?** A healthy agent doing real work should fail on 10-20% of steps at most (network errors, transient issues). 50% means more than half the work is producing errors — fundamentally broken.

---

## Edge Case Handling

| Edge Case | How It's Handled |
|---|---|
| **Duplicate events** (`same event sent twice`) | `INSERT OR IGNORE` with `UNIQUE(session_id, step)` — second write silently ignored |
| **Duplicate step numbers** | Same mechanism — first writer wins |
| **Out-of-order events** | Events always sorted by `step ASC` before analysis — arrival order never assumed |
| **Events arriving late** | Same as out-of-order — stored and re-sorted on next detection run |
| **Missing `metadata`** | Pydantic default `EventMetadata()` fills in `status="success"`, `file=null` |
| **Missing optional fields** | `input` and `output` default to `""` — detection still runs, just on empty tokens |
| **Missing required fields** | `session_id` and `step` are required — returns HTTP 422 with field-level errors |
| **Malformed JSON** | Returns HTTP 400 before Pydantic validation |
| **Very fast event bursts** | FastAPI async I/O + SQLite WAL mode — readers don't block writers |
| **Multiple concurrent sessions** | Fully isolated by `session_id` — no shared state between sessions |

---

## API Reference

```
POST /events
  Body: EventIn (see schema below)
  Returns: { accepted, duplicate, session_id, step }
  Status 201 on new event, 201 on duplicate (idempotent), 422 on validation error

GET /sessions
  Returns: list of SessionSummary
  Fields: session_id, status, stats, event_count, first_seen, last_seen, issues

GET /sessions/{session_id}
  Returns: SessionDetail
  Fields: session_id, status, stats, events[], issues[], insights[]

GET /sessions/{session_id}/insights
  Returns: { session_id, insights[] }  (plain-language strings only)

GET /health
  Returns: { status: "ok", timestamp }
```

**Event schema:**

```json
{
  "session_id": "string (required)",
  "timestamp": "number (required)",
  "step": "integer >= 0 (required)",
  "action": "read_file | write_file | run_command | llm_call (required)",
  "input": "string (optional, default: '')",
  "output": "string (optional, default: '')",
  "metadata": {
    "file": "string | null (optional)",
    "status": "success | failure (optional, default: success)"
  }
}
```

---

## Design Decisions & Trade-offs

### Storage: SQLite over in-memory or Postgres

**Decision:** SQLite with WAL mode, stored at `backend/agent_events.db`

**Why not pure in-memory (Python dict)?**
- Doesn't survive backend restarts — a monitoring system that loses its data on restart is broken by design
- No deduplication at the storage level; would need separate logic

**Why not Postgres/Redis?**
- Adds setup friction (install, start service, create database)
- Overkill: single-writer access pattern, no need for distributed reads
- Goal is "local setup is fine" — SQLite ships with Python, zero config

**SQLite WAL mode** specifically allows concurrent reads during writes — important when the frontend is polling while the simulator is sending events.

**Known limitation:** SQLite is single-writer. Under true high-concurrency ingestion (hundreds of concurrent sessions sending events simultaneously), writes would queue. Fix: batch-write events, or switch to Postgres for production.

---

### Processing: On-Write Recomputation (not batch, not streaming)

**Decision:** Every `POST /events` triggers full detection re-run for that session

**Why not batch (e.g., cron every 5 seconds)?**
- Introduces stale data — the UI would show outdated status
- For the session sizes in this system (10-50 events), per-event recomputation is fast (<5ms)

**Why not true streaming (Kafka, Redis Streams)?**
- Overkill for local dev
- Would require a separate stream processor, consumer group, etc.
- The "near real-time" behavior of on-write recomputation is sufficient

**Known limitation:** For sessions with thousands of events, O(n) detection per new event degrades. Fix: cache computed metrics and recompute incrementally.

---

### Detection: Heuristics over Rules

All three detectors deliberately avoid:
- **Simple string equality** — loops aren't exact duplicates
- **Fixed magic numbers without reasoning** — every threshold is documented with a rationale
- **Single signal** — failure detection uses two independent signals

The philosophy: detection should behave like an experienced developer reading logs, not like a regex.

---

### Frontend: Polling over WebSockets

**Decision:** Frontend polls every 3 seconds

**Why not WebSockets or SSE?**
- Polling is simpler to implement, easier to debug, and works through proxies/firewalls
- 3-second latency is acceptable for a dev monitoring tool

**Trade-off:** 3-second poll creates ~20 requests/minute per open browser tab. For production with many users, SSE would reduce server load.

---

### Time Constraints

What was deprioritized:
- Auth / API keys (not in scope for local dev)
- Pagination on `/sessions` (no sessions list will be large in this context)
- Incremental detection (full recomputation is fast enough for simulator-scale sessions)
- Change-point detection for drift (midpoint split works well for the scenarios)
