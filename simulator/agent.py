#!/usr/bin/env python3
"""
Agent Simulator CLI

Usage:
    python agent.py --scenario normal
    python agent.py --scenario loop
    python agent.py --scenario drift
    python agent.py --scenario failure
    python agent.py --scenario all          # runs all 4 in interleaved order
    python agent.py --scenario normal --session-id my-session-42
    python agent.py --scenario loop --delay 0.05 --api http://localhost:8000
"""
from __future__ import annotations

import argparse
import random
import time
import uuid
import sys
import json
from dataclasses import dataclass, field
from typing import Callable

try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed. Run: pip install requests")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DEFAULT_API = "http://localhost:8000"
DEFAULT_DELAY = 0.1   # seconds between events


# ---------------------------------------------------------------------------
# Event builder
# ---------------------------------------------------------------------------

@dataclass
class Event:
    session_id: str
    timestamp: float
    step: int
    action: str
    input: str
    output: str
    status: str = "success"
    file: str | None = None

    def to_dict(self) -> dict:
        return {
            "session_id": self.session_id,
            "timestamp": self.timestamp,
            "step": self.step,
            "action": self.action,
            "input": self.input,
            "output": self.output,
            "metadata": {
                "file": self.file,
                "status": self.status,
            },
        }


def send(event: Event, api_url: str, verbose: bool = True):
    try:
        resp = requests.post(
            f"{api_url}/events",
            json=event.to_dict(),
            timeout=5,
        )
        if verbose:
            mark = "OK" if resp.status_code == 201 else "!!"
            dup = " [duplicate]" if resp.json().get("duplicate") else ""
            print(f"  {mark} step={event.step:>3}  {event.action:<15} {event.status}{dup}")
    except requests.exceptions.ConnectionError:
        print(f"  !! Cannot connect to {api_url}. Is the backend running?")
        sys.exit(1)
    except Exception as e:
        print(f"  !! Error sending event: {e}")


# ---------------------------------------------------------------------------
# Scenario: NORMAL
# A clean, logical file-editing task that reaches a conclusion.
# ---------------------------------------------------------------------------

def scenario_normal(session_id: str, api_url: str, delay: float):
    print(f"\n[normal] session={session_id}")
    # Action types are interleaved throughout both halves so distribution stays stable.
    # First half: read -> llm -> write -> run
    # Second half: read -> llm -> write -> run  (mirrors first half)
    steps = [
        ("read_file",    "requirements.txt",                "flask==2.3.0\nrequests==2.28.0",      "success", "requirements.txt"),
        ("llm_call",     "Summarise dependencies",          "Flask web framework + HTTP client",    "success", None),
        ("write_file",   "notes/deps.md",                   "Documented dependency summary",        "success", "notes/deps.md"),
        ("run_command",  "pip install -r requirements.txt", "Successfully installed 2 packages",    "success", None),
        ("read_file",    "app/config.py",                   "DEBUG=False\nDB_URL=sqlite:///app.db", "success", "app/config.py"),
        ("llm_call",     "Review config for issues",        "DEBUG should be env-driven",           "success", None),
        ("write_file",   "app/config.py",                   "Updated DEBUG to use os.getenv",       "success", "app/config.py"),
        ("run_command",  "pytest tests/",                   "..........  10 passed",                "success", None),
    ]
    base_ts = time.time()
    for i, (action, inp, out, status, fname) in enumerate(steps):
        ev = Event(
            session_id=session_id,
            timestamp=base_ts + i * 0.8,
            step=i + 1,
            action=action,
            input=inp,
            output=out,
            status=status,
            file=fname,
        )
        send(ev, api_url)
        time.sleep(delay)


# ---------------------------------------------------------------------------
# Scenario: LOOP
# Agent repeatedly tries to fix a linting error with slight variations.
# NOT exact duplicates — filenames, line numbers, and messages vary.
# ---------------------------------------------------------------------------

def scenario_loop(session_id: str, api_url: str, delay: float):
    print(f"\n[loop] session={session_id}")

    # Preamble — looks normal
    base_ts = time.time()
    preamble = [
        ("read_file",  "src/utils.py",    "def helper(x):\n    return x+1", "success", "src/utils.py"),
        ("llm_call",   "Check utils.py for lint issues", "Found unused import on line 3", "success", None),
    ]
    for i, (action, inp, out, status, fname) in enumerate(preamble):
        send(Event(session_id, base_ts + i, i + 1, action, inp, out, status, fname), api_url)
        time.sleep(delay)

    # Loop: agent keeps trying to fix "the same" lint problem with tiny variations
    lint_errors = [
        "W0611 unused-import 'os' at line 3",
        "W0611 unused-import 'os' at line 3 in src/utils.py",
        "W0611 unused-import: 'os' (line 3, col 0)",
        "W0611 unused-import 'os' — src/utils.py:3",
        "Lint error W0611: 'os' imported but never used (line 3)",
        "pylint: W0611 unused import 'os', line 3",
        "unused import 'os' detected at line 3 of src/utils.py",
    ]
    fixes = [
        "Removed import os from src/utils.py",
        "Deleted unused import on line 3",
        "Stripped 'import os' from utils",
        "Ran autoflake to remove unused imports",
        "Applied fix: deleted line 3 (import os)",
        "Re-ran lint fixer on utils.py",
        "Committed lint fix attempt #6",
    ]

    step = 3
    for j in range(7):
        # Run linter — always sees the same problem (slight variation in message)
        send(Event(
            session_id, base_ts + step * 0.5, step,
            "run_command", f"pylint src/utils.py --msg-template='{{msg_id}} {{msg}}'",
            lint_errors[j % len(lint_errors)],
            "failure", None,
        ), api_url)
        step += 1
        time.sleep(delay)

        # LLM decides how to fix it
        send(Event(
            session_id, base_ts + step * 0.5, step,
            "llm_call", f"How do I fix: {lint_errors[j % len(lint_errors)]}",
            f"Remove the unused import. {fixes[j % len(fixes)]}",
            "success", None,
        ), api_url)
        step += 1
        time.sleep(delay)

        # Attempts the fix
        send(Event(
            session_id, base_ts + step * 0.5, step,
            "write_file", f"src/utils.py (attempt {j+1})",
            fixes[j % len(fixes)],
            "success", "src/utils.py",
        ), api_url)
        step += 1
        time.sleep(delay)


# ---------------------------------------------------------------------------
# Scenario: DRIFT
# Starts as a documentation task, silently pivots to running migrations.
# Drift is not telegraphed — the shift happens gradually.
# ---------------------------------------------------------------------------

def scenario_drift(session_id: str, api_url: str, delay: float):
    print(f"\n[drift] session={session_id}")
    base_ts = time.time()

    # Phase 1: Documentation work (read_file + llm_call heavy)
    phase1 = [
        ("read_file",  "docs/api.md",              "# API Reference\n## GET /users", "success", "docs/api.md"),
        ("llm_call",   "Identify outdated endpoints in docs", "GET /users/v1 is deprecated", "success", None),
        ("read_file",  "docs/auth.md",              "# Auth\nUse Bearer tokens", "success", "docs/auth.md"),
        ("llm_call",   "Check auth docs accuracy",  "Auth docs are accurate for v2", "success", None),
        ("read_file",  "docs/errors.md",            "# Error codes\n400, 401, 403, 500", "success", "docs/errors.md"),
        ("llm_call",   "Suggest doc improvements",  "Add 429 rate-limit error code", "success", None),
        ("write_file", "docs/errors.md",            "Added 429 Too Many Requests", "success", "docs/errors.md"),
    ]

    # Phase 2: Pivots to running DB migrations (run_command heavy)
    # The "reason" is buried in LLM output — agent found a migration issue
    phase2 = [
        ("llm_call",   "Check if schema matches docs",      "Schema is missing users.last_login column", "success", None),
        ("run_command","alembic current",                    "Current: a3f9d12 (head)", "success", None),
        ("run_command","alembic history --verbose",          "3 pending migrations found", "success", None),
        ("run_command","alembic upgrade head",               "Running migration a3f9d12 -> b8c2e45", "success", None),
        ("run_command","python manage.py check_schema",      "Schema OK", "success", None),
        ("run_command","pytest tests/db/ -v",                "8 passed", "success", None),
        ("write_file", "migrations/README.md",               "Updated migration log", "success", "migrations/README.md"),
    ]

    all_steps = phase1 + phase2
    for i, (action, inp, out, status, fname) in enumerate(all_steps):
        send(Event(session_id, base_ts + i * 0.6, i + 1, action, inp, out, status, fname), api_url)
        time.sleep(delay)


# ---------------------------------------------------------------------------
# Scenario: FAILURE
# Agent retries a broken deployment repeatedly, escalating attempts.
# ---------------------------------------------------------------------------

def scenario_failure(session_id: str, api_url: str, delay: float):
    print(f"\n[failure] session={session_id}")
    base_ts = time.time()

    # Initial setup — healthy start
    preamble = [
        ("read_file",  "deploy/config.yml",     "env: production\nregion: us-east-1", "success", "deploy/config.yml"),
        ("llm_call",   "Review deploy config",  "Config looks valid, proceed", "success", None),
    ]
    for i, (action, inp, out, status, fname) in enumerate(preamble):
        send(Event(session_id, base_ts + i, i + 1, action, inp, out, status, fname), api_url)
        time.sleep(delay)

    # Repeated failing deploy attempts with slightly different commands
    deploy_cmds = [
        "kubectl apply -f deploy/k8s.yml",
        "kubectl apply -f deploy/k8s.yml --force",
        "helm upgrade --install app ./chart",
        "helm upgrade --install app ./chart --wait --timeout 120s",
        "kubectl rollout restart deployment/app",
        "kubectl delete pod -l app=api && kubectl apply -f deploy/k8s.yml",
        "docker-compose -f deploy/docker-compose.prod.yml up -d",
    ]
    errors = [
        "Error: ImagePullBackOff for container 'api'",
        "Error: ImagePullBackOff persists after force apply",
        "Error: INSTALLATION FAILED: failed to pull image",
        "Error: timed out waiting for the condition",
        "Error: rollout failed: ImagePullBackOff",
        "Error: pod not ready after 60s — ImagePullBackOff",
        "Error: service unhealthy — container exited with code 1",
    ]
    recovery_attempts = [
        "docker pull gcr.io/project/api:latest",
        "gcloud auth configure-docker",
        "kubectl create secret docker-registry regcred ...",
        "aws ecr get-login-password | docker login",
        "kubectl describe pod api-xxx to get details",
        "check GCR quota and permissions",
        "try alternative registry mirror",
    ]

    step = 3
    for j in range(7):
        # Attempt to deploy — fails
        send(Event(
            session_id, base_ts + step * 0.4, step,
            "run_command", deploy_cmds[j % len(deploy_cmds)],
            errors[j % len(errors)],
            "failure", None,
        ), api_url)
        step += 1
        time.sleep(delay)

        # Ask LLM for recovery — gets advice but it doesn't help
        send(Event(
            session_id, base_ts + step * 0.4, step,
            "llm_call",
            f"Deploy failed: {errors[j % len(errors)]}. How to fix?",
            f"Try: {recovery_attempts[j % len(recovery_attempts)]}",
            "success", None,
        ), api_url)
        step += 1
        time.sleep(delay)

        # Tries the recovery — also fails
        send(Event(
            session_id, base_ts + step * 0.4, step,
            "run_command", recovery_attempts[j % len(recovery_attempts)],
            f"Error: {random.choice(['permission denied', 'timeout', 'not found', 'network error'])}",
            "failure", None,
        ), api_url)
        step += 1
        time.sleep(delay)


# ---------------------------------------------------------------------------
# Edge case: inject out-of-order + duplicate events for a session
# ---------------------------------------------------------------------------

def scenario_edge_cases(session_id: str, api_url: str, delay: float):
    """Sends duplicate and out-of-order events to verify robustness."""
    print(f"\n[edge-cases] session={session_id}")
    base_ts = time.time()

    events = [
        Event(session_id, base_ts + 1, 1, "read_file", "main.py", "contents...", "success", "main.py"),
        Event(session_id, base_ts + 3, 3, "llm_call",  "Analyse main.py", "All good", "success", None),
        Event(session_id, base_ts + 2, 2, "write_file","main.py", "Updated", "success", "main.py"),  # out of order
        Event(session_id, base_ts + 1, 1, "read_file", "main.py", "contents...", "success", "main.py"),  # duplicate step 1
        Event(session_id, base_ts + 3, 3, "llm_call",  "Analyse main.py", "All good", "success", None),  # duplicate step 3
        Event(session_id, base_ts + 4, 4, "run_command", "pytest", "2 passed", "success", None),
    ]
    for ev in events:
        send(ev, api_url)
        time.sleep(delay)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

SCENARIOS: dict[str, Callable] = {
    "normal":      scenario_normal,
    "loop":        scenario_loop,
    "drift":       scenario_drift,
    "failure":     scenario_failure,
    "edge-cases":  scenario_edge_cases,
}


def main():
    parser = argparse.ArgumentParser(
        description="Agent activity simulator for agent-observability system",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument(
        "--scenario",
        choices=list(SCENARIOS.keys()) + ["all"],
        default="normal",
        help=(
            "Scenario to simulate:\n"
            "  normal     — clean task execution\n"
            "  loop       — repeated actions (fuzzy, not identical)\n"
            "  drift      — intent change mid-session\n"
            "  failure    — persistent failures with retries\n"
            "  edge-cases — duplicates + out-of-order events\n"
            "  all        — run all scenarios concurrently\n"
        ),
    )
    parser.add_argument("--session-id", default=None, help="Override session ID (default: random UUID)")
    parser.add_argument("--api", default=DEFAULT_API, help=f"API base URL (default: {DEFAULT_API})")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY, help="Seconds between events (default: 0.1)")

    args = parser.parse_args()

    if args.scenario == "all":
        import threading
        threads = []
        for name, fn in SCENARIOS.items():
            if name == "edge-cases":
                continue
            sid = f"{name}-{uuid.uuid4().hex[:8]}"
            t = threading.Thread(target=fn, args=(sid, args.api, args.delay), daemon=True)
            threads.append(t)

        print(f"Starting all scenarios concurrently against {args.api}")
        for t in threads:
            t.start()
            time.sleep(0.2)  # slight stagger so steps interleave naturally
        for t in threads:
            t.join()
        print("\nAll scenarios complete.")
    else:
        session_id = args.session_id or f"{args.scenario}-{uuid.uuid4().hex[:8]}"
        fn = SCENARIOS[args.scenario]
        print(f"Running scenario '{args.scenario}' against {args.api}")
        fn(session_id, args.api, args.delay)
        print(f"\nDone. View at {args.api}/sessions/{session_id}")


if __name__ == "__main__":
    main()
