import type { ActionType } from "@/lib/api";

const CONFIG: Record<ActionType, { label: string; classes: string }> = {
  read_file:   { label: "read_file",   classes: "bg-sky-100    text-sky-800"    },
  write_file:  { label: "write_file",  classes: "bg-violet-100 text-violet-800" },
  run_command: { label: "run_command", classes: "bg-orange-100 text-orange-800" },
  llm_call:    { label: "llm_call",    classes: "bg-pink-100   text-pink-800"   },
};

export default function ActionBadge({ action }: { action: ActionType }) {
  const { label, classes } = CONFIG[action] ?? { label: action, classes: "bg-gray-100 text-gray-700" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium ${classes}`}>
      {label}
    </span>
  );
}
