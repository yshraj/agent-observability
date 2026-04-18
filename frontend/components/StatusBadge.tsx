import type { SessionStatus } from "@/lib/api";

const CONFIG: Record<SessionStatus, { label: string; classes: string }> = {
  healthy:  { label: "Healthy",  classes: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  looping:  { label: "Looping",  classes: "bg-amber-100  text-amber-800  border-amber-200"  },
  drifting: { label: "Drifting", classes: "bg-blue-100   text-blue-800   border-blue-200"   },
  failing:  { label: "Failing",  classes: "bg-red-100    text-red-800    border-red-200"    },
};

export default function StatusBadge({ status }: { status: SessionStatus }) {
  const { label, classes } = CONFIG[status] ?? CONFIG.healthy;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${classes}`}>
      {label}
    </span>
  );
}
