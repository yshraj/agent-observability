"""
Detection engine for agent behavioral issues.

Three detectors, each returning DetectedIssue objects:

1. LoopDetector   — fuzzy pattern matching over sliding windows
2. DriftDetector  — action-distribution shift between session halves
3. FailureDetector — consecutive failures + abnormal failure rate
"""

from __future__ import annotations
import re
from collections import Counter
from models import EventRecord, DetectedIssue, SessionStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _tokenize(text: str) -> set[str]:
    """Lowercase alphanumeric tokens, strips punctuation."""
    return set(re.findall(r"[a-z0-9_/.-]+", text.lower()))


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 1.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union)


def _action_distribution(events: list[EventRecord]) -> dict[str, float]:
    if not events:
        return {}
    counts = Counter(e.action for e in events)
    total = len(events)
    return {k: v / total for k, v in counts.items()}


def _total_variation_distance(p: dict[str, float], q: dict[str, float]) -> float:
    """TVD = 0.5 * sum |p(x) - q(x)| over all keys."""
    all_keys = set(p) | set(q)
    return 0.5 * sum(abs(p.get(k, 0.0) - q.get(k, 0.0)) for k in all_keys)


# ---------------------------------------------------------------------------
# Loop Detector
# ---------------------------------------------------------------------------

LOOP_WINDOW = 8          # look back this many steps
LOOP_SIM_THRESHOLD = 0.6  # Jaccard similarity to consider two steps "similar"
LOOP_MIN_REPEATS = 3      # minimum similar steps to flag


def detect_loops(events: list[EventRecord]) -> list[DetectedIssue]:
    """
    Within a sliding window of LOOP_WINDOW steps, check whether >= LOOP_MIN_REPEATS
    events share the same action type AND have Jaccard similarity >= LOOP_SIM_THRESHOLD
    on their input text.

    We group by action first to avoid cross-action false positives, then cluster
    by pairwise similarity.
    """
    if len(events) < LOOP_MIN_REPEATS:
        return []

    issues: list[DetectedIssue] = []

    # Slide a window across the event list
    for window_start in range(len(events)):
        window = events[window_start: window_start + LOOP_WINDOW]

        # Group by action type within the window
        by_action: dict[str, list[EventRecord]] = {}
        for ev in window:
            by_action.setdefault(ev.action, []).append(ev)

        for action, group in by_action.items():
            if len(group) < LOOP_MIN_REPEATS:
                continue

            tokens = [_tokenize(ev.input) for ev in group]

            # Find clusters: greedily group events that are mutually similar
            visited = [False] * len(group)
            for i in range(len(group)):
                if visited[i]:
                    continue
                cluster = [i]
                for j in range(i + 1, len(group)):
                    if not visited[j] and _jaccard(tokens[i], tokens[j]) >= LOOP_SIM_THRESHOLD:
                        cluster.append(j)
                        visited[j] = True

                if len(cluster) >= LOOP_MIN_REPEATS:
                    affected = [group[k].step for k in cluster]
                    # Deduplicate: skip if we already reported a loop covering these steps
                    if not any(
                        set(affected) <= set(existing.affected_steps)
                        for existing in issues
                    ):
                        avg_sim = sum(
                            _jaccard(tokens[cluster[a]], tokens[cluster[b]])
                            for a in range(len(cluster))
                            for b in range(a + 1, len(cluster))
                        ) / max(1, (len(cluster) * (len(cluster) - 1)) / 2)

                        severity = "high" if avg_sim > 0.85 else "medium"
                        issues.append(DetectedIssue(
                            issue_type="loop",
                            description=(
                                f"Repeated '{action}' detected across {len(cluster)} steps "
                                f"(avg similarity {avg_sim:.0%}). "
                                f"Steps: {sorted(affected)}"
                            ),
                            severity=severity,
                            affected_steps=sorted(affected),
                        ))

    return issues


# ---------------------------------------------------------------------------
# Drift Detector
# ---------------------------------------------------------------------------

DRIFT_MIN_EVENTS = 6          # don't flag drift in tiny sessions
DRIFT_TVD_THRESHOLD = 0.40    # total variation distance between halves


def detect_drift(events: list[EventRecord]) -> list[DetectedIssue]:
    """
    Split session into first-half and second-half by step order.
    Compute action-type distribution for each half.
    If TVD >= DRIFT_TVD_THRESHOLD, the agent changed behavioural pattern.

    Extra signal: if the dominant action type flipped between halves, severity = high.
    """
    if len(events) < DRIFT_MIN_EVENTS:
        return []

    mid = len(events) // 2
    first_half = events[:mid]
    second_half = events[mid:]

    dist1 = _action_distribution(first_half)
    dist2 = _action_distribution(second_half)
    tvd = _total_variation_distance(dist1, dist2)

    if tvd < DRIFT_TVD_THRESHOLD:
        return []

    dominant1 = max(dist1, key=dist1.get) if dist1 else "none"
    dominant2 = max(dist2, key=dist2.get) if dist2 else "none"

    flipped = dominant1 != dominant2
    severity = "high" if flipped else "medium"

    description = (
        f"Agent intent shifted mid-session (TVD={tvd:.2f}). "
        f"Early pattern: mostly '{dominant1}'; later pattern: mostly '{dominant2}'."
    )

    return [DetectedIssue(
        issue_type="drift",
        description=description,
        severity=severity,
        affected_steps=[e.step for e in events[mid:]],
    )]


# ---------------------------------------------------------------------------
# Failure Detector
# ---------------------------------------------------------------------------

FAILURE_CONSECUTIVE_THRESHOLD = 3   # N consecutive failures = issue
FAILURE_RATE_THRESHOLD = 0.50        # 50%+ failure rate = issue
FAILURE_RATE_MIN_EVENTS = 6          # need at least this many to flag rate


def detect_failures(events: list[EventRecord]) -> list[DetectedIssue]:
    """
    Two independent signals:
      1. Consecutive failures (≥ FAILURE_CONSECUTIVE_THRESHOLD)
      2. Abnormal failure rate (≥ FAILURE_RATE_THRESHOLD with ≥ FAILURE_RATE_MIN_EVENTS)
    """
    issues: list[DetectedIssue] = []

    # --- Signal 1: consecutive failures ---
    max_streak = 0
    streak = 0
    streak_steps: list[int] = []
    best_streak_steps: list[int] = []

    for ev in events:
        if ev.metadata_status == "failure":
            streak += 1
            streak_steps.append(ev.step)
            if streak > max_streak:
                max_streak = streak
                best_streak_steps = list(streak_steps)
        else:
            streak = 0
            streak_steps = []

    if max_streak >= FAILURE_CONSECUTIVE_THRESHOLD:
        issues.append(DetectedIssue(
            issue_type="failure",
            description=(
                f"{max_streak} consecutive failures detected. "
                f"Steps: {best_streak_steps}"
            ),
            severity="high" if max_streak >= 5 else "medium",
            affected_steps=best_streak_steps,
        ))

    # --- Signal 2: abnormal failure rate ---
    if len(events) >= FAILURE_RATE_MIN_EVENTS:
        total = len(events)
        failures = sum(1 for e in events if e.metadata_status == "failure")
        rate = failures / total
        if rate >= FAILURE_RATE_THRESHOLD:
            failure_steps = [e.step for e in events if e.metadata_status == "failure"]
            issues.append(DetectedIssue(
                issue_type="failure",
                description=(
                    f"Abnormal failure rate: {rate:.0%} ({failures}/{total} steps failed)."
                ),
                severity="high" if rate >= 0.75 else "medium",
                affected_steps=failure_steps,
            ))

    return issues


# ---------------------------------------------------------------------------
# Session-level aggregator
# ---------------------------------------------------------------------------

def run_all_detectors(events: list[EventRecord]) -> tuple[SessionStatus, list[DetectedIssue]]:
    """
    Run all detectors and derive an overall session status.
    Priority: failing > looping > drifting > healthy
    """
    if not events:
        return SessionStatus.healthy, []

    issues: list[DetectedIssue] = []
    issues += detect_failures(events)
    issues += detect_loops(events)
    issues += detect_drift(events)

    has_failure = any(i.issue_type == "failure" for i in issues)
    has_loop = any(i.issue_type == "loop" for i in issues)
    has_drift = any(i.issue_type == "drift" for i in issues)

    if has_failure:
        status = SessionStatus.failing
    elif has_loop:
        status = SessionStatus.looping
    elif has_drift:
        status = SessionStatus.drifting
    else:
        status = SessionStatus.healthy

    return status, issues


# ---------------------------------------------------------------------------
# Insight generator
# ---------------------------------------------------------------------------

def generate_insights(
    events: list[EventRecord],
    issues: list[DetectedIssue],
    stats: dict,
) -> list[str]:
    """Plain-language sentences surfaced in the UI."""
    insights: list[str] = []

    if not events:
        return ["No events recorded yet."]

    total = stats.get("total_steps", 0)
    failure_rate = stats.get("failure_rate", 0.0)
    dist = stats.get("action_distribution", {})

    # General summary
    insights.append(
        f"Session completed {total} steps across "
        f"{len(set(e.action for e in events))} distinct action type(s)."
    )

    # Dominant action
    if dist:
        dominant = max(dist, key=dist.get)
        pct = dist[dominant] / total * 100 if total else 0
        insights.append(f"Most frequent action: '{dominant}' ({pct:.0f}% of steps).")

    # Failure insight
    if failure_rate > 0:
        insights.append(
            f"Overall failure rate: {failure_rate:.0%}. "
            + ("This is within normal range." if failure_rate < 0.20 else "Investigate failing steps.")
        )

    # Per-issue insights
    for issue in issues:
        if issue.issue_type == "loop":
            insights.append(
                f"Loop detected: the agent repeated similar actions "
                f"{len(issue.affected_steps)} times. This may indicate the agent "
                f"is stuck or retrying without making progress."
            )
        elif issue.issue_type == "drift":
            insights.append(
                f"Behavioral drift: the agent changed its activity pattern "
                f"around step {issue.affected_steps[0] if issue.affected_steps else '?'}. "
                f"Check whether this represents a goal change or confusion."
            )
        elif issue.issue_type == "failure":
            insights.append(
                f"Failure pattern: {issue.description} "
                f"Consider inspecting inputs/outputs at these steps."
            )

    return insights
