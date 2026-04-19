import type { SessionStatus } from "@/lib/api";

const CONFIG: Record<SessionStatus, { label: string; dot: string; pill: string }> = {
  healthy:  {
    label: "Healthy",
    dot:  "bg-emerald-500",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  },
  looping:  {
    label: "Looping",
    dot:  "bg-amber-500",
    pill: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  },
  drifting: {
    label: "Drifting",
    dot:  "bg-blue-500",
    pill: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
  },
  failing:  {
    label: "Failing",
    dot:  "bg-red-500",
    pill: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800",
  },
};

export default function StatusBadge({ status }: { status: SessionStatus }) {
  const { label, dot, pill } = CONFIG[status] ?? CONFIG.healthy;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
