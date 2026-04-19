"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api, type SessionSummary } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import ThemeToggle from "@/components/ThemeToggle";

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function elapsed(first: number, last: number) {
  const s = Math.round(last - first);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

const STAT_CARDS = [
  {
    key: "healthy"  as const,
    label: "Healthy",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    ),
    gradient: "from-emerald-500 to-teal-500",
    softBg:   "bg-emerald-50 dark:bg-emerald-950/40",
    iconColor:"text-emerald-600 dark:text-emerald-400",
    numColor: "text-emerald-700 dark:text-emerald-300",
  },
  {
    key: "looping"  as const,
    label: "Looping",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
    ),
    gradient: "from-amber-500 to-orange-500",
    softBg:   "bg-amber-50 dark:bg-amber-950/40",
    iconColor:"text-amber-600 dark:text-amber-400",
    numColor: "text-amber-700 dark:text-amber-300",
  },
  {
    key: "drifting" as const,
    label: "Drifting",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
    gradient: "from-blue-500 to-indigo-500",
    softBg:   "bg-blue-50 dark:bg-blue-950/40",
    iconColor:"text-blue-600 dark:text-blue-400",
    numColor: "text-blue-700 dark:text-blue-300",
  },
  {
    key: "failing"  as const,
    label: "Failing",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    ),
    gradient: "from-red-500 to-rose-500",
    softBg:   "bg-red-50 dark:bg-red-950/40",
    iconColor:"text-red-600 dark:text-red-400",
    numColor: "text-red-700 dark:text-red-300",
  },
];

export default function SessionsPage() {
  const [sessions, setSessions]     = useState<SessionSummary[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

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
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>

      {/* ── Topbar ── */}
      <header
        className="sticky top-0 z-10 border-b"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <span className="font-semibold text-sm" style={{ color: "var(--tx-1)" }}>
              Agent Observability
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2">
            {lastRefresh && (
              <span className="text-xs hidden sm:block" style={{ color: "var(--tx-3)" }}>
                Updated {lastRefresh.toLocaleTimeString("en-US")}
              </span>
            )}
            <button
              onClick={load}
              className="h-8 px-3 text-xs font-medium rounded-lg border cursor-pointer transition-colors"
              style={{
                background: "var(--primary-bg)",
                color: "var(--primary)",
                borderColor: "var(--ring)",
              }}
            >
              Refresh
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">

        {/* ── Stat cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {STAT_CARDS.map(({ key, label, icon, softBg, iconColor, numColor }) => (
            <div
              key={key}
              className={`rounded-xl p-5 border ${softBg}`}
              style={{ borderColor: "var(--border)" }}
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${iconColor}`}
                   style={{ background: "var(--surface)" }}>
                {icon}
              </div>
              <div className={`text-3xl font-bold tabular-nums ${numColor}`}>
                {counts[key]}
              </div>
              <div className="text-xs font-medium mt-1" style={{ color: "var(--tx-2)" }}>
                {label}
              </div>
            </div>
          ))}
        </div>

        {/* ── States ── */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex items-center gap-3" style={{ color: "var(--tx-3)" }}>
              <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              <span className="text-sm">Loading sessions…</span>
            </div>
          </div>
        )}

        {error && (
          <div
            className="rounded-xl border px-4 py-3 text-sm flex items-center gap-2 mb-6"
            style={{
              background: "var(--surface)",
              borderColor: "#FCA5A5",
              color: "#DC2626",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-center py-24">
            <div className="w-12 h-12 rounded-xl mx-auto flex items-center justify-center mb-4"
                 style={{ background: "var(--primary-bg)", color: "var(--primary)" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
              </svg>
            </div>
            <p className="text-base font-medium mb-1" style={{ color: "var(--tx-1)" }}>No sessions yet</p>
            <p className="text-sm mb-4" style={{ color: "var(--tx-3)" }}>Start the simulator to see data here</p>
            <code
              className="text-xs px-3 py-2 rounded-lg border font-mono"
              style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--tx-2)" }}
            >
              python agent.py --scenario normal
            </code>
          </div>
        )}

        {/* ── Session table ── */}
        {sessions.length > 0 && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col />
                <col style={{ width: 130 }} />
                <col style={{ width: 68  }} />
                <col style={{ width: 68  }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 90  }} />
              </colgroup>

              <thead>
                <tr style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
                  {["Session", "Status", "Steps", "Fail %", "Issues", "Duration"].map((h, i) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-xs font-medium uppercase tracking-wider"
                      style={{
                        color: "var(--tx-3)",
                        textAlign: i === 0 ? "left" : i <= 1 || i === 4 ? "center" : "right",
                        paddingLeft:  i === 0 ? 20 : undefined,
                        paddingRight: i === 5 ? 20 : undefined,
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {sessions.map((s, idx) => {
                  const failPct    = Math.round(s.stats.failure_rate * 100);
                  const issueTypes = [...new Set(s.issues.map(i => i.issue_type))];
                  const dur        = elapsed(s.first_seen, s.last_seen);
                  const isLast     = idx === sessions.length - 1;

                  return (
                    <tr
                      key={s.session_id}
                      className="group cursor-pointer transition-colors"
                      style={{ borderBottom: isLast ? "none" : "1px solid var(--border)" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      onClick={() => window.location.href = `/sessions/${encodeURIComponent(s.session_id)}`}
                    >
                      {/* Session ID */}
                      <td className="py-4 align-middle" style={{ paddingLeft: 20, paddingRight: 16 }}>
                        <p className="text-sm font-mono font-medium truncate" style={{ color: "var(--tx-1)" }}>
                          {s.session_id}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--tx-3)" }}>
                          {fmt(s.first_seen)} → {fmt(s.last_seen)}
                        </p>
                      </td>

                      {/* Status */}
                      <td className="py-4 align-middle text-center px-2">
                        <StatusBadge status={s.status} />
                      </td>

                      {/* Steps */}
                      <td className="py-4 align-middle text-right px-2">
                        <span className="text-sm font-semibold tabular-nums" style={{ color: "var(--tx-1)" }}>
                          {s.stats.total_steps}
                        </span>
                      </td>

                      {/* Fail % */}
                      <td className="py-4 align-middle text-right px-2">
                        <span
                          className="text-sm font-semibold tabular-nums"
                          style={{ color: failPct > 40 ? "#DC2626" : failPct > 0 ? "#D97706" : "var(--tx-3)" }}
                        >
                          {failPct}%
                        </span>
                      </td>

                      {/* Issues */}
                      <td className="py-4 align-middle text-center px-2">
                        {issueTypes.length === 0 ? (
                          <span style={{ color: "var(--tx-3)" }}>—</span>
                        ) : (
                          <div className="flex items-center gap-1 justify-center flex-wrap">
                            {issueTypes.map(t => (
                              <span
                                key={t}
                                className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize border ${
                                  t === "loop"
                                    ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700"
                                    : t === "drift"
                                    ? "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-700"
                                    : "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/50 dark:text-red-300 dark:border-red-700"
                                }`}
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* Duration */}
                      <td className="py-4 align-middle" style={{ paddingRight: 20 }}>
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="text-xs tabular-nums" style={{ color: "var(--tx-3)" }}>{dur}</span>
                          <svg
                            width="13" height="13" viewBox="0 0 24 24" fill="none"
                            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            style={{ color: "var(--tx-3)" }}
                          >
                            <path d="M5 12h14M12 5l7 7-7 7"/>
                          </svg>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Footer */}
            <div
              className="px-5 py-3 text-xs border-t"
              style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--tx-3)" }}
            >
              {sessions.length} session{sessions.length !== 1 ? "s" : ""} · auto-refreshing every 3s
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
