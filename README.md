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
Verify it is running:

```cmd
curl http://localhost:8000/health
```

Expected response: `{"status":"ok","timestamp":...}`

### 2. Frontend

Open a **second terminal** window:

```cmd
cd frontend
npm install
npm run dev
```

The UI opens at `http://localhost:3000`.

> If port 3000 is busy, Next.js will try 3001 automatically — check the terminal output for the actual URL.

### 3. Simulator (runs in a third terminal)

```cmd
cd simulator
pip install requests
```

Then run any scenario (see next section).

### Stopping the servers

Press `Ctrl+C` in each terminal window.

---

## Windows Troubleshooting

### WinError 10013 — port access forbidden

This happens when a previous uvicorn process is still holding the port, or Windows has reserved it.

**Step 1 — find what's using the port:**

```cmd
netstat -ano | findstr :8000
```

Note the PID in the last column.

**Step 2 — kill it (use PowerShell):**

```powershell
Stop-Process -Id <PID> -Force -ErrorAction SilentlyContinue
```

Or in Command Prompt:

```cmd
taskkill /F /PID <PID>
```

**Step 3 — wait 5 seconds** for Windows to fully release the socket, then retry:

```cmd
uvicorn main:app --reload --port 8000
```

**If the port stays blocked, use a different port:**

```cmd
uvicorn main:app --reload --port 8001
```

Then update `frontend\.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8001
```

And pass `--api` to the simulator:

```cmd
python agent.py --scenario all --api http://localhost:8001
```

### Port reserved by Windows / Hyper-V

Windows reserves certain port ranges for Hyper-V and other services. Check reserved ranges:

```cmd
netsh int ipv4 show excludedportrange protocol=tcp
```

If port 8000 appears in that list, use 8001, 8080, or 9000 instead (same steps above).

### Python not found

```cmd
python --version
```

If this fails, ensure Python is added to PATH during installation. Re-run the Python installer and check "Add Python to PATH".

### npm not found

```cmd
node --version
npm --version
```

If these fail, re-install Node.js from https://nodejs.org and restart your terminal.

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

**Algorithm:** Sliding window TVD (Total Variation Distance)

```
Parameters:
  WINDOW_SIZE = 4   steps per window
  STEP        = 2   slide by this many steps each iteration
  TVD_THRESHOLD = 0.45

For each consecutive pair of overlapping windows:
  Window A = events[i   : i+4]
  Window B = events[i+2 : i+6]

  Compute action-type distribution for each:
    e.g. dist_A = {read_file: 1.0}
         dist_B = {read_file: 0.5, llm_call: 0.5}

  Compute TVD:
    TVD = 0.5 * sum(|p(x) - q(x)|) for all action types

  If TVD >= 0.45:
    Record drift at the boundary step
    Find which action gained most share and which lost most
    Suppress if another drift was flagged within WINDOW_SIZE steps
```

**Why TVD?**

TVD is a principled statistical measure of how different two probability distributions are. It ranges from 0 (identical) to 1 (completely disjoint).

- A naive rule like "if action type changed" would flag any session that uses more than one action type
- TVD requires a *sustained, significant* shift — transient changes don't move the distribution enough
- A TVD of 0.45 means roughly 45% of the probability mass has shifted between windows

**Why sliding windows instead of a midpoint split?**

A midpoint split has a fundamental flaw: if a session drifts twice, the two shifts can cancel each other out and produce a low TVD even though two real transitions occurred.

Example — a session that goes `read_file` (steps 1–4) → `llm_call` (steps 5–8) → `run_command` (steps 9–13):

```
Midpoint split (broken):
  First half:  {read_file: 50%, llm_call: 50%}   ← averaged across both phases
  Second half: {llm_call: 40%, run_command: 60%}
  TVD ≈ 0.35  → MISSED (below threshold)

Sliding windows (correct):
  Window [1-4] vs [3-6]: TVD=0.50 → drift at step 3  (read_file → llm_call)
  Window [5-8] vs [7-10]: TVD=0.50 → drift at step 7  (llm_call → run_command)
  → Both transitions caught independently
```

Each window boundary is evaluated independently, so multiple drifts are all detected and reported as separate issues.

**Deduplication guard:** once a drift is flagged at step X, the next flag must be at least `WINDOW_SIZE` steps later. This prevents the same single transition from firing on multiple overlapping window pairs.

**Description logic:** instead of reporting "dominant action before/after" (which is ambiguous when distributions are tied at 50/50), the description reports which action type *gained* the most share and which *lost* the most — always unambiguous.

**Minimum 6 events:** distributions computed from 2–3 events have high variance. A session that does `read_file` then `llm_call` isn't drifting — it's just getting started.

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

---

### 1. Data Storage: SQLite over in-memory or Postgres

**Decision:** SQLite with WAL mode (`backend/agent_events.db`)

Three options were considered:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Python dict (in-memory) | Zero setup, fastest reads | Lost on restart, no dedup at DB level, no concurrent access safety | Rejected |
| SQLite | Ships with Python, survives restarts, WAL mode, unique constraints | Single writer | **Chosen** |
| Postgres | Production-grade, concurrent writes, rich query planner | Requires install + running service, overkill for local dev | Rejected |

**Why SQLite specifically wins here:**

- A monitoring system that loses all data on backend restart is broken by design — in-memory was never a real option
- `UNIQUE(session_id, step)` constraint gives deduplication for free at the DB level with `INSERT OR IGNORE` — no application-level tracking needed
- **WAL mode** (`PRAGMA journal_mode=WAL`) is the key detail: in WAL mode, readers and writers don't block each other. The frontend can poll `GET /sessions` while the simulator is actively writing events — no lock contention
- Zero configuration — ships with Python, single file, works on any OS

**Known limitation:** SQLite serialises writes. If hundreds of concurrent agents were all sending events simultaneously, the write queue would grow. The production fix is either batching writes (accumulate 50 events, flush in one transaction) or switching to Postgres.

---

### 2. Real-time vs Batch Processing

**Decision:** On-write synchronous recomputation — detection runs immediately on every accepted event

Three approaches were considered:

**Batch (cron every N seconds):**
- Pro: decouples ingestion from processing, cheaper under burst
- Con: stale data — the UI could show "healthy" for seconds after a failure started
- Con: unnecessary for this session size (10–50 events). Batch adds complexity that only pays off at scale
- **Rejected**

**True streaming (Kafka, Redis Streams, Faust):**
- Pro: handles massive throughput, proper backpressure, replay
- Con: requires running Kafka/Redis, a consumer process, consumer group management
- Con: overkill — the entire point of the assignment is local setup
- **Rejected**

**On-write recomputation (chosen):**
```
POST /events → store event → re-run detection → update cache → return response
```
- Every accepted event immediately triggers detection for that session
- Results stored in `session_cache` table — frontend just reads, never waits for processing
- For 10–50 event sessions, the full detection cycle takes < 5ms
- No separate process, no queue, no consumer — one Python process does everything

**Known limitation:** Detection is O(n) per new event (fetches all events, runs all three detectors). For a session with 10,000 events this degrades. The fix is incremental computation — maintain running counters and only re-evaluate the tail of the event list.

---

### 3. Detection Thresholds and Reasoning

Every threshold was chosen based on a specific failure mode it avoids. None are arbitrary.

#### Loop Detection

| Parameter | Value | Why this value |
|---|---|---|
| Jaccard similarity threshold | 0.60 | Below 0.60 → false positives from legitimately similar actions (two `read_file` calls on config files share tokens like `import`, `config`, `=`). Above 0.75 → misses fuzzy loops where filenames or flags vary slightly. |
| Window size | 8 steps | A window of 3–4 is too small — catches only the tightest loops. A window of 15+ compares steps that are contextually unrelated, producing false positives. 8 covers a full retry cycle (check → decide → act) repeated 2–3 times. |
| Minimum cluster size | 3 events | Two similar actions could be coincidence (reading two config files). Three is the minimum that indicates a pattern rather than noise. |
| Severity: high | avg similarity > 0.85 | Near-identical inputs (>85%) suggest the agent is copy-pasting its own previous action — a hard loop. Lower similarity means the agent is varying its approach, which is less urgent. |

#### Drift Detection

| Parameter | Value | Why this value |
|---|---|---|
| TVD threshold | 0.45 | Below 0.40 → normal sessions that naturally use multiple action types trigger false positives. Above 0.55 → only catches extreme pivots; gradual drifts are missed. 0.45 sits in the range where the distribution has genuinely shifted but not necessarily flipped entirely. |
| Window size | 4 steps | Small enough to detect a drift that happens over 3–5 steps. Large enough that a single unusual step doesn't skew the distribution. |
| Slide step | 2 steps | Overlapping windows (overlap = window - step = 2) means every transition boundary is evaluated from two angles, reducing the chance of missing a drift that falls exactly between windows. |
| Minimum session length | 6 events | A distribution computed from 2–3 events has high variance — 1 unusual action out of 3 is 33%, which would look like drift. At 6+ events, the distribution is meaningful. |
| Deduplication guard | WINDOW_SIZE steps | Without this, a single drift transition would fire on every overlapping window pair that straddles it, producing 2–3 duplicate issues for the same event. |

#### Failure Detection

| Parameter | Value | Why this value |
|---|---|---|
| Consecutive failure streak | ≥ 3 | 1 failure = transient error (network, typo). 2 = possibly bad luck. 3 in a row = the agent is stuck — it tried, failed, adjusted, failed, adjusted, failed. That's a retry loop, not noise. |
| High severity streak | ≥ 5 | 5 consecutive failures means the agent has been stuck long enough that intervention is urgent, not just advisory. |
| Failure rate threshold | ≥ 50% | A healthy agent doing real development work fails 10–20% of the time (typos, missing files, transient errors). 50% means more than half of all actions are failing — fundamentally broken. |
| Rate minimum events | 6 | 1 failure out of 2 events = 50% rate, but it's meaningless statistically. At 6+ events, a 50% rate represents a real pattern. |

**The dual-signal design for failure** is intentional: scattered failures (high rate, no consecutive streak) and bursty failures (long streak, lower overall rate) are both serious but look different in the data. Using only one signal would miss half the failure patterns.

---

### 4. Trade-offs Due to Time Constraints

| What was skipped | What was done instead | Cost of the shortcut |
|---|---|---|
| Auth / API keys | No auth | Anyone with network access can write events. Acceptable for local dev; unacceptable in production. |
| Incremental detection | Full O(n) recomputation per event | Degrades for sessions > ~500 events. Fix: maintain running counters, only re-evaluate the tail. |
| Adaptive window sizing for drift | Fixed window of 4 steps | Long sessions (100+ steps) need a larger window to avoid noise. Fix: scale window size with session length. |
| Pagination on session list | Return all sessions | Works fine for < 100 sessions. Fix: add `?page=&limit=` query params. |
| WebSocket / SSE for live updates | 3-second polling | ~20 requests/minute per browser tab. Acceptable for dev; wasteful in production. |
| Per-agent baseline learning | Global fixed thresholds | Some agent types legitimately fail more often (test runners). Fixed thresholds may false-positive on them. Fix: track per-session-type baseline failure rates. |
