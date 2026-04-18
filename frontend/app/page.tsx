"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api, type SessionSummary } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString();
}

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center bg-gray-800 rounded-lg px-3 py-2 min-w-[72px]">
      <span className="text-base font-semibold text-gray-100">{value}</span>
      <span className="text-xs text-gray-400 mt-0.5">{label}</span>
    </div>
  );
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = useCallback(async () => {
    try {
      const data = await api.listSessions();
      setSessions(data);
      setError(null);
    } catch {
      setError("Cannot reach backend. Is it running on port 8000?");
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);

  const counts = {
    healthy:  sessions.filter(s => s.status === "healthy").length,
    looping:  sessions.filter(s => s.status === "looping").length,
    drifting: sessions.filter(s => s.status === "drifting").length,
    failing:  sessions.filter(s => s.status === "failing").length,
  };

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Agent Observability</h1>
          <p className="text-xs text-gray-400 mt-0.5">Real-time monitoring for AI agent sessions</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            Refreshed {lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={load}
            className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 transition-colors cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Summary strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {([
            { label: "Healthy",  value: counts.healthy,  color: "text-emerald-400" },
            { label: "Looping",  value: counts.looping,  color: "text-amber-400"  },
            { label: "Drifting", value: counts.drifting, color: "text-blue-400"   },
            { label: "Failing",  value: counts.failing,  color: "text-red-400"    },
          ] as const).map(({ label, value, color }) => (
            <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
              <div className={`text-3xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-gray-400 mt-1">{label}</div>
            </div>
          ))}
        </div>

        {loading && (
          <div className="text-center py-20 text-gray-500">Loading sessions…</div>
        )}

        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <p className="text-lg mb-3">No sessions yet.</p>
            <p className="text-sm text-gray-600 mb-2">Start the simulator:</p>
            <code className="text-xs bg-gray-900 px-3 py-1.5 rounded border border-gray-800 text-gray-300">
              python agent.py --scenario normal
            </code>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">
              {sessions.length} session{sessions.length !== 1 ? "s" : ""} · auto-refreshing
            </p>
            {sessions.map((s) => {
              const failPct = Math.round(s.stats.failure_rate * 100);
              const topAction = Object.entries(s.stats.action_distribution).sort(
                (a, b) => b[1] - a[1]
              )[0];

              return (
                <Link
                  key={s.session_id}
                  href={`/sessions/${encodeURIComponent(s.session_id)}`}
                  className="block bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-3">
                        <StatusBadge status={s.status} />
                        <span className="font-mono text-sm text-gray-300 truncate">
                          {s.session_id}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2 mb-3">
                        <StatPill label="steps"    value={s.stats.total_steps} />
                        <StatPill label="fail rate" value={`${failPct}%`} />
                        {topAction && (
                          <StatPill label="top action" value={topAction[0].replace("_", " ")} />
                        )}
                      </div>

                      {s.issues.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {s.issues.slice(0, 3).map((issue, i) => (
                            <span
                              key={i}
                              className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700"
                            >
                              {issue.issue_type} · {issue.severity}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="text-right text-xs text-gray-500 shrink-0">
                      <div>{fmt(s.first_seen)}</div>
                      <div className="text-gray-600">→ {fmt(s.last_seen)}</div>
                      <div className="mt-3 text-gray-600 group-hover:text-gray-400 transition-colors text-sm">
                        View →
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
