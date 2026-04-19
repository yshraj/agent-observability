import type { ActionType } from "@/lib/api";

const CONFIG: Record<ActionType, { label: string; classes: string }> = {
  read_file:   {
    label: "read_file",
    classes: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800",
  },
  write_file:  {
    label: "write_file",
    classes: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:border-violet-800",
  },
  run_command: {
    label: "run_command",
    classes: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800",
  },
  llm_call:    {
    label: "llm_call",
    classes: "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950 dark:text-pink-300 dark:border-pink-800",
  },
};

export default function ActionBadge({ action }: { action: ActionType }) {
  const { label, classes } = CONFIG[action] ?? {
    label: action,
    classes: "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-medium border ${classes}`}>
      {label}
    </span>
  );
}
