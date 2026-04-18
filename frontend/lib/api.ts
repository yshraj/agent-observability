const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type ActionType = "read_file" | "write_file" | "run_command" | "llm_call";
export type SessionStatus = "healthy" | "looping" | "drifting" | "failing";
export type IssueType = "loop" | "drift" | "failure";
export type Severity = "low" | "medium" | "high";

export interface SessionStats {
  total_steps: number;
  success_count: number;
  failure_count: number;
  failure_rate: number;
  action_distribution: Record<string, number>;
}

export interface DetectedIssue {
  issue_type: IssueType;
  description: string;
  severity: Severity;
  affected_steps: number[];
}

export interface SessionSummary {
  session_id: string;
  status: SessionStatus;
  stats: SessionStats;
  event_count: number;
  first_seen: number;
  last_seen: number;
  issues: DetectedIssue[];
}

export interface EventRecord {
  session_id: string;
  timestamp: number;
  step: number;
  action: ActionType;
  input: string;
  output: string;
  metadata_file: string | null;
  metadata_status: "success" | "failure";
  received_at: number;
}

export interface SessionDetail {
  session_id: string;
  status: SessionStatus;
  stats: SessionStats;
  events: EventRecord[];
  issues: DetectedIssue[];
  insights: string[];
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  listSessions: () => apiFetch<SessionSummary[]>("/sessions"),
  getSession: (id: string) => apiFetch<SessionDetail>(`/sessions/${encodeURIComponent(id)}`),
};
