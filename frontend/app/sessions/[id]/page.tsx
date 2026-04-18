"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, type SessionDetail, type EventRecord, type DetectedIssue } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import ActionBadge from "@/components/ActionBadge";

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function IssueCard({ issue }: { issue: DetectedIssue }) {
  const colors: Record<string, string> = {
    loop:    "border-amber-700 bg-amber-950 text-amber-200",
    drift:   "border-blue-700  bg-blue-950  text-blue-200",
    failure: "border-red-700   bg-red-950   text-red-200",
  };
  const severityDot: Record<string, string> = {
    high:   "bg-red-400",
    medium: "bg-amber-400",
    low:    "bg-gray-400",
  };

  return (
    <div className={`border rounded-lg p-4 ${colors[issue.issue_type] ?? "border-gray-700 bg-gray-900"}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`w-2 h-2 rounded-full ${severityDot[issue.severity]}`} />
        <span className="font-semibold capitalize text-sm">{issue.issue_type}</span>
        <span className="text-xs opacity-60 ml-auto">{issue.severity} severity</span>
      </div>
      <p className="text-xs leading-5 opacity-80">{issue.description}</p>
      {issue.affected_steps.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {issue.affected_steps.slice(0, 12).map(s => (
            <span key={s} className="text-xs bg-black/20 px-1.5 py-0.5 rounded font-mono">
              #{s}
            </span>
          ))}
          {issue.affected_steps.length > 12 && (
            <span className="text-xs opacity-50">+{issue.affected_steps.length - 12} more</span>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ event, isAffected }: { event: EventRecord; isAffected: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`border-l-2 pl-4 py-2 cursor-pointer transition-colors ${
        isAffected ? "border-red-600" : "border-gray-700"
      } hover:bg-gray-800/50`}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-mono text-gray-500 w-8 text-right">#{event.step}</span>
        <ActionBadge action={event.action} />
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
          event.metadata_status === "failure"
            ? "bg-red-900 text-red-300"
            : "bg-emerald-900 text-emerald-300"
        }`}>
          {event.metadata_status}
        </span>
        <span className="text-xs text-gray-400 truncate max-w-xs flex-1">{event.input}</span>
        <span className="text-xs text-gray-600 ml-auto">{fmt(event.timestamp)}</span>
      </div>

      {expanded && (
        <div className="mt-2 space-y-1.5">
          {event.metadata_file && (
            <p className="text-xs text-gray-400">
              <span className="text-gray-600">file:</span> {event.metadata_file}
            </p>
          )}
          <div className="text-xs bg-gray-950 rounded p-2 font-mono whitespace-pre-wrap text-gray-300 max-h-40 overflow-auto">
            <span className="text-gray-600">input:  </span>{event.input}{"\n"}
            <span className="text-gray-600">output: </span>{event.output}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = decodeURIComponent(params.id as string);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Collect affected steps from all issues
  const affectedSteps = new Set(
    session?.issues.flatMap(i => i.affected_steps) ?? []
  );

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            ← All Sessions
          </Link>
          <span className="text-gray-700">/</span>
          <span className="font-mono text-sm text-gray-300 truncate">{sessionId}</span>
          {session && <StatusBadge status={session.status} />}
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {loading && (
          <div className="text-center py-20 text-gray-500">Loading session…</div>
        )}
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        {session && (
          <div className="space-y-8">
            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Steps",  value: session.stats.total_steps },
                { label: "Successes",    value: session.stats.success_count },
                { label: "Failures",     value: session.stats.failure_count },
                { label: "Failure Rate", value: `${Math.round(session.stats.failure_rate * 100)}%` },
              ].map(({ label, value }) => (
                <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
                  <div className="text-2xl font-bold text-gray-100">{value}</div>
                  <div className="text-xs text-gray-400 mt-1">{label}</div>
                </div>
              ))}
            </div>

            {/* Action distribution */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-gray-300 mb-4">Action Distribution</h2>
              <div className="space-y-2">
                {Object.entries(session.stats.action_distribution)
                  .sort((a, b) => b[1] - a[1])
                  .map(([action, count]) => {
                    const pct = Math.round((count / session.stats.total_steps) * 100);
                    return (
                      <div key={action} className="flex items-center gap-3">
                        <span className="font-mono text-xs text-gray-400 w-28 shrink-0">{action}</span>
                        <div className="flex-1 bg-gray-800 rounded-full h-2">
                          <div
                            className="bg-indigo-500 h-2 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Detected Issues */}
            {session.issues.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-300 mb-3">
                  Detected Issues ({session.issues.length})
                </h2>
                <div className="space-y-3">
                  {session.issues.map((issue, i) => (
                    <IssueCard key={i} issue={issue} />
                  ))}
                </div>
              </div>
            )}

            {/* Insights */}
            {session.insights.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-300 mb-3">Insights</h2>
                <ul className="space-y-2">
                  {session.insights.map((insight, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-400">
                      <span className="text-indigo-400 mt-0.5">›</span>
                      {insight}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Event Timeline */}
            <div>
              <h2 className="text-sm font-semibold text-gray-300 mb-3">
                Event Timeline
                <span className="ml-2 text-xs font-normal text-gray-500">
                  (click to expand)
                  {affectedSteps.size > 0 && (
                    <span className="ml-2 text-red-400">
                      · {affectedSteps.size} flagged steps highlighted
                    </span>
                  )}
                </span>
              </h2>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-1">
                {session.events.map(ev => (
                  <EventRow
                    key={ev.step}
                    event={ev}
                    isAffected={affectedSteps.has(ev.step)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
