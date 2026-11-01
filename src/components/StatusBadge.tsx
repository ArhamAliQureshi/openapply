const STYLES: Record<string, [string, string]> = {
  needs_input: ["Needs you", "bg-amber-100 text-amber-800"],
  ready: ["Ready", "bg-sky-100 text-sky-800"],
  filling: ["Filling…", "bg-sky-100 text-sky-800"],
  dry_run_done: ["Dry run done", "bg-violet-100 text-violet-800"],
  submitted: ["Submitted", "bg-emerald-100 text-emerald-800"],
  blocked: ["Blocked: needs you", "bg-amber-100 text-amber-800"],
  failed: ["Failed", "bg-red-100 text-red-800"],
};

export function StatusBadge({ status }: { status: string }) {
  const [label, cls] = STYLES[status] ?? [status, "bg-neutral-100 text-neutral-700"];
  return <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
