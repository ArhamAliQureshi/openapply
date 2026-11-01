"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  score: number;
  reasons: string[];
  status: string;
  url: string;
  applicationId: string | null;
  note: string | null;
};

const TAB_LABELS: Record<string, string> = { new: "New matches", needs_you: "Needs you", done: "Applied / dry run", skipped: "Skipped" };

const STATUS_LABEL: Record<string, string> = {
  queued: "Planned",
  needs_you: "Needs you",
  applied: "Applied",
  dry_run: "Dry run done",
  skipped: "Skipped",
  dismissed: "Dismissed",
  failed: "Failed",
  closed: "Closed",
};

export function FeedList({ tab, counts, jobs }: { tab: string; counts: Record<string, number>; jobs: Job[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Rows hidden optimistically (dismissed/restored) before the server confirms.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const hide = (id: string, on: boolean) =>
    setHidden((h) => {
      const next = new Set(h);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function act(id: string, action: "plan" | "dismiss" | "restore") {
    if (busy === id || hidden.has(id)) return;
    setError(null);
    // Dismiss/restore move the row to another tab: remove it now, put it back if the server fails.
    if (action !== "plan") hide(id, true);
    else setBusy(id);
    const res = await fetch(`/api/feed/jobs/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      hide(id, false);
      return setError(json.error ?? "Something went wrong.");
    }
    if (json.applicationId) router.push(`/apply/${json.applicationId}`);
    else router.refresh(); // updates tab counts
  }

  const visible = jobs.filter((j) => !hidden.has(j.id));

  return (
    <section className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex flex-wrap gap-1 border-b border-neutral-200 px-3 pt-3">
        {Object.entries(TAB_LABELS).map(([key, label]) => (
          <Link
            key={key}
            href={`/jobs?tab=${key}`}
            className={`rounded-t-md px-3 py-2 text-sm ${key === tab ? "border-b-2 border-teal-700 font-medium text-teal-800" : "text-neutral-600 hover:text-neutral-900"}`}
          >
            {label} <span className="text-neutral-400">{counts[key] ?? 0}</span>
          </Link>
        ))}
      </div>
      {error && <p className="px-4 pt-3 text-sm text-red-600">{error}</p>}
      {visible.length === 0 ? (
        <p className="p-6 text-sm text-neutral-500">
          {tab === "new" ? "No new matches. Add job titles above and click Refresh jobs." : "Nothing here yet."}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {visible.map((j) => (
            <li key={j.id} className="flex items-start gap-4 px-4 py-3">
              <span
                className={`mt-0.5 w-10 shrink-0 rounded-md py-1 text-center text-sm font-semibold ${j.score >= 85 ? "bg-emerald-100 text-emerald-800" : j.score >= 70 ? "bg-sky-100 text-sky-800" : "bg-neutral-100 text-neutral-600"}`}
                title="Match score"
              >
                {j.score}
              </span>
              <div className="min-w-0 flex-1">
                <a href={j.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                  {j.title}
                </a>
                <p className="text-sm text-neutral-600">
                  {j.company} · {j.location || "—"}
                  {j.remote && " · Remote"}
                </p>
                <p className="mt-0.5 truncate text-xs text-neutral-500">{j.note ?? j.reasons.join(" · ")}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-sm">
                {j.status !== "new" && <span className="text-xs text-neutral-500">{STATUS_LABEL[j.status] ?? j.status}</span>}
                {j.applicationId ? (
                  <Link href={`/apply/${j.applicationId}`} className="rounded-md border border-neutral-300 px-2.5 py-1 hover:bg-neutral-50">
                    Open
                  </Link>
                ) : j.status === "new" ? (
                  <>
                    <button
                      type="button"
                      disabled={busy === j.id}
                      onClick={() => act(j.id, "plan")}
                      className="rounded-md bg-teal-700 px-2.5 py-1 font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                    >
                      {busy === j.id ? "Reading…" : "Plan"}
                    </button>
                    <button type="button" onClick={() => act(j.id, "dismiss")} className="text-xs text-neutral-500 hover:text-red-600">
                      Dismiss
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => act(j.id, "restore")} className="text-xs text-neutral-500 hover:text-neutral-900">
                    Restore
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
