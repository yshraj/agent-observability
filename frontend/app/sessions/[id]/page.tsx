"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, type SessionDetail, type EventRecord, type DetectedIssue } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import ActionBadge from "@/components/ActionBadge";
import ThemeToggle from "@/components/ThemeToggle";

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

/* ── Stat card ── */
function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ background: "var(--surface)", borderColor: "var(--border)" }}
    >
      <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: "var(--tx-3)" }}>
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums" style={{ color: "var(--tx-1)" }}>{value}</p>
      {sub && <p className="text-xs mt-1" style={{ color: "var(--tx-3)" }}>{sub}</p>}
    </div>
  );
}

/* ── Issue card ── */
const ISSUE_STYLE: Record<string, { bg: string; border: string; title: string; icon: React.ReactNode }> = {
  loop: {
    bg:     "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-800",
    title:  "text-amber-800 dark:text-amber-300",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
    ),
  },
  drift: {
    bg:     "bg-blue-50 dark:bg-blue-950/40",
    border: "border-blue-200 dark:border-blue-800",
    title:  "text-blue-800 dark:text-blue-300",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
  },
  failure: {
    bg:     "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-800",
    title:  "text-red-800 dark:text-red-300",
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    ),
  },
};

const SEV_BADGE: Record<string, string> = {
  high:   "bg-red-100 text-red-700 dark:bg-red-900/60 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300",
  low:    "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

function IssueCard({ issue }: { issue: DetectedIssue }) {
  const style = ISSUE_STYLE[issue.issue_type] ?? ISSUE_STYLE.failure;
  return (
    <div className={`rounded-xl border p-4 ${style.bg} ${style.border}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={style.title}>{style.icon}</span>
        <span className={`text-sm font-semibold capitalize ${style.title}`}>{issue.issue_type}</span>
        <span className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${SEV_BADGE[issue.severity]}`}>
          {issue.severity}
        </span>
      </div>
      <p className="text-xs leading-5" style={{ color: "var(--tx-2)" }}>{issue.description}</p>
      {issue.affected_steps.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {issue.affected_steps.slice(0, 14).map(s => (
            <span
              key={s}
              className="text-xs px-1.5 py-0.5 rounded font-mono border"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--tx-3)" }}
            >
              #{s}
            </span>
          ))}
          {issue.affected_steps.length > 14 && (
            <span className="text-xs" style={{ color: "var(--tx-3)" }}>
              +{issue.affected_steps.length - 14} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Event row ── */
function EventRow({ event, isAffected }: { event: EventRecord; isAffected: boolean }) {
  const [open, setOpen] = useState(false);
  const failed = event.metadata_status === "failure";

  return (
    <div
      className="border-b last:border-b-0 cursor-pointer transition-colors"
      style={{ borderColor: "var(--border)" }}
      onClick={() => setOpen(v => !v)}
      onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        {/* Step number */}
        <span
          className="text-xs font-mono w-8 text-right shrink-0 select-none"
          style={{ color: isAffected ? "#EF4444" : "var(--tx-3)" }}
        >
          {event.step}
        </span>

        {/* Flagged indicator */}
        {isAffected && (
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
        )}

        <ActionBadge action={event.action} />

        <span
          className="text-xs font-medium px-2 py-0.5 rounded-full border"
          style={
            failed
              ? { background: "#FEF2F2", color: "#B91C1C", borderColor: "#FCA5A5" }
              : { background: "#F0FDF4", color: "#166534", borderColor: "#86EFAC" }
          }
        >
          {failed ? "failure" : "success"}
        </span>

        <span
          className="text-xs flex-1 truncate"
          style={{ color: "var(--tx-2)" }}
        >
          {event.input || <em style={{ color: "var(--tx-3)" }}>no input</em>}
        </span>

        <span className="text-xs shrink-0 ml-auto" style={{ color: "var(--tx-3)" }}>
          {fmt(event.timestamp)}
        </span>

        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
          style={{ color: "var(--tx-3)" }}
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>

      {open && (
        <div
          className="px-4 pb-3 pt-0 mx-4 mb-3 rounded-lg border text-xs font-mono whitespace-pre-wrap leading-5 max-h-40 overflow-auto"
          style={{
            background: "var(--surface-2)",
            borderColor: "var(--border)",
            color: "var(--tx-2)",
          }}
        >
          {event.metadata_file && (
            <div className="mb-1" style={{ color: "var(--tx-3)" }}>
              file: {event.metadata_file}
            </div>
          )}
          <span style={{ color: "var(--tx-3)" }}>input:  </span>{event.input || "—"}{"\n"}
          <span style={{ color: "var(--tx-3)" }}>output: </span>{event.output || "—"}
        </div>
      )}
    </div>
  );
}

/* ── Page ── */
export default function SessionDetailPage() {
  const params    = useParams();
  const sessionId = decodeURIComponent(params.id as string);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getSession(sessionId);
      setSession(data);
      setError(null);
    } catch {
      setError("Session not found or backend unreachable.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const affectedSteps = new Set(session?.issues.flatMap(i => i.affected_steps) ?? []);

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>

      {/* Topbar */}
      <header
        className="sticky top-0 z-10 border-b"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {/* Logo */}
            <Link href="/" className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </Link>

            <Link
              href="/"
              className="text-xs font-medium transition-colors hidden sm:block"
              style={{ color: "var(--tx-3)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--tx-1)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--tx-3)")}
            >
              Sessions
            </Link>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 className="shrink-0" style={{ color: "var(--tx-3)" }}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <span
              className="text-sm font-mono font-medium truncate"
              style={{ color: "var(--tx-1)" }}
            >
              {sessionId}
            </span>
            {session && <StatusBadge status={session.status} />}
          </div>

          <ThemeToggle />
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">

        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex items-center gap-3" style={{ color: "var(--tx-3)" }}>
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              <span className="text-sm">Loading session…</span>
            </div>
          </div>
        )}

        {error && (
          <div
            className="rounded-xl border px-4 py-3 text-sm flex items-center gap-2"
            style={{ background: "var(--surface)", borderColor: "#FCA5A5", color: "#DC2626" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {session && (
          <>
            {/* ── Stats ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Total Steps"  value={session.stats.total_steps} />
              <StatCard label="Successes"    value={session.stats.success_count} />
              <StatCard label="Failures"     value={session.stats.failure_count} />
              <StatCard
                label="Failure Rate"
                value={`${Math.round(session.stats.failure_rate * 100)}%`}
                sub={session.stats.failure_count > 0 ? `${session.stats.failure_count} of ${session.stats.total_steps} steps` : "All steps succeeded"}
              />
            </div>

            {/* ── Two-column: distribution + issues ── */}
            <div className="grid md:grid-cols-2 gap-4">

              {/* Action distribution */}
              <div
                className="rounded-xl border p-5"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--tx-1)" }}>
                  Action Distribution
                </h2>
                <div className="space-y-3">
                  {Object.entries(session.stats.action_distribution)
                    .sort((a, b) => b[1] - a[1])
                    .map(([action, count]) => {
                      const pct = Math.round((count / session.stats.total_steps) * 100);
                      return (
                        <div key={action} className="flex items-center gap-3">
                          <span className="font-mono text-xs w-24 shrink-0" style={{ color: "var(--tx-3)" }}>
                            {action}
                          </span>
                          <div
                            className="flex-1 rounded-full h-1.5"
                            style={{ background: "var(--surface-2)" }}
                          >
                            <div
                              className="h-1.5 rounded-full transition-all"
                              style={{ width: `${pct}%`, background: "var(--primary)" }}
                            />
                          </div>
                          <span className="text-xs tabular-nums w-8 text-right" style={{ color: "var(--tx-2)" }}>
                            {pct}%
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Insights */}
              <div
                className="rounded-xl border p-5"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                <h2 className="text-sm font-semibold mb-4" style={{ color: "var(--tx-1)" }}>
                  Insights
                </h2>
                {session.insights.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--tx-3)" }}>No insights yet.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {session.insights.map((insight, i) => (
                      <li key={i} className="flex gap-2.5 text-xs leading-5" style={{ color: "var(--tx-2)" }}>
                        <span className="mt-0.5 shrink-0" style={{ color: "var(--primary)" }}>›</span>
                        {insight}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* ── Detected issues ── */}
            {session.issues.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--tx-1)" }}>
                  Detected Issues
                  <span
                    className="ml-2 text-xs font-normal px-1.5 py-0.5 rounded-full border"
                    style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--tx-3)" }}
                  >
                    {session.issues.length}
                  </span>
                </h2>
                <div className="space-y-3">
                  {session.issues.map((issue, i) => <IssueCard key={i} issue={issue} />)}
                </div>
              </div>
            )}

            {/* ── Event timeline ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold" style={{ color: "var(--tx-1)" }}>
                  Event Timeline
                </h2>
                <div className="flex items-center gap-3 text-xs" style={{ color: "var(--tx-3)" }}>
                  {affectedSteps.size > 0 && (
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                      {affectedSteps.size} flagged
                    </span>
                  )}
                  <span>click row to expand</span>
                </div>
              </div>

              <div
                className="rounded-xl border overflow-hidden"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              >
                {/* Column headers */}
                <div
                  className="grid grid-cols-[32px_auto_auto_auto_1fr_auto_20px] items-center px-4 py-2 border-b text-xs font-medium uppercase tracking-wide"
                  style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--tx-3)" }}
                >
                  <span className="text-right">#</span>
                  <span className="pl-2" />
                  <span className="pl-2">Action</span>
                  <span className="pl-3">Status</span>
                  <span className="pl-3">Input</span>
                  <span className="text-right pr-5">Time</span>
                  <span />
                </div>

                {session.events.map(ev => (
                  <EventRow
                    key={ev.step}
                    event={ev}
                    isAffected={affectedSteps.has(ev.step)}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
