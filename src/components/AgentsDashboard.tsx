"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Activity, ActivityKind } from "@/lib/activity";
import { AgentsSkeleton } from "./Skeleton";

const KIND: Record<ActivityKind, { label: string; cls: string }> = {
  autopilot: { label: "Autopilot", cls: "bg-teal-100 text-teal-800" },
  feed: { label: "Job feed", cls: "bg-sky-100 text-sky-800" },
  plan: { label: "Form reader", cls: "bg-indigo-100 text-indigo-800" },
  fill: { label: "Form filler", cls: "bg-violet-100 text-violet-800" },
  resume: { label: "Resume reader", cls: "bg-amber-100 text-amber-800" },
  ai: { label: "AI writer", cls: "bg-pink-100 text-pink-800" },
};

const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export function AgentsDashboard() {
  const [data, setData] = useState<{ now: number; activities: Activity[] } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/agents", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (alive) {
            setData(d);
            setError(false);
          }
        })
        .catch(() => alive && setError(true));
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!data) return error ? <p className="mt-6 text-sm text-red-600">Can&apos;t reach the server.</p> : <AgentsSkeleton />;

  const running = data.activities.filter((a) => a.status === "running");
  const finished = data.activities.filter((a) => a.status !== "running");
  const byKind = Object.entries(
    running.reduce<Record<string, number>>((m, a) => ((m[a.kind] = (m[a.kind] ?? 0) + 1), m), {}),
  );
  // Children (e.g. form fills inside an autopilot run) are shown under their parent.
  const roots = running.filter((a) => !a.parentId || !running.some((p) => p.id === a.parentId));
  const childrenOf = (id: string) => running.filter((a) => a.parentId === id);

  return (
    <div className="mt-6 space-y-6">
      <section className="flex flex-wrap items-center gap-4 rounded-xl border border-neutral-200 bg-white p-5">
        <div>
          <p className="text-4xl font-bold tabular-nums">{running.length}</p>
          <p className="text-sm text-neutral-600">running now</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {byKind.length === 0 ? (
            <span className="text-sm text-neutral-500">Idle. Start something from Jobs, Applications or Profile.</span>
          ) : (
            byKind.map(([k, n]) => (
              <span key={k} className={`rounded-full px-2.5 py-1 text-xs font-medium ${KIND[k as ActivityKind].cls}`}>
                {n} × {KIND[k as ActivityKind].label}
              </span>
            ))
          )}
        </div>
        {error && <span className="ml-auto text-xs text-red-600">Connection lost, retrying…</span>}
      </section>

      {roots.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">Running</h2>
          {roots.map((a) => (
            <RunningCard key={a.id} a={a} now={data.now} childItems={childrenOf(a.id)} />
          ))}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">Recent</h2>
        {finished.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing has finished since the server started.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white">
            {finished.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${KIND[a.kind].cls}`}>{KIND[a.kind].label}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate">{a.label}</p>
                  {a.result && <p className={`truncate text-xs ${a.status === "failed" ? "text-red-600" : "text-neutral-500"}`}>{a.result}</p>}
                </div>
                <span className={`shrink-0 text-xs ${a.status === "failed" ? "text-red-600" : "text-emerald-700"}`}>
                  {a.status === "failed" ? "✗ failed" : "✓ done"} · {duration((a.endedAt ?? data.now) - a.startedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-neutral-500">
        History covers this server session only. Application results are kept permanently on the{" "}
        <Link href="/apply" className="text-teal-700 hover:underline">
          Applications
        </Link>{" "}
        page.
      </p>
    </div>
  );
}

function RunningCard({ a, now, childItems }: { a: Activity; now: number; childItems: Activity[] }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <span className="relative mt-1.5 flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${KIND[a.kind].cls}`}>{KIND[a.kind].label}</span>
            <span className="font-medium">{a.label}</span>
          </div>
          <p className="mt-1 text-sm text-neutral-700">{a.step}</p>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-neutral-500">{duration(now - a.startedAt)}</span>
      </div>
      {childItems.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-l-2 border-neutral-100 pl-4">
          {childItems.map((c) => (
            <li key={c.id} className="text-sm">
              <span className={`mr-2 rounded px-1.5 py-0.5 text-xs font-medium ${KIND[c.kind].cls}`}>{KIND[c.kind].label}</span>
              {c.label} <span className="text-neutral-500">— {c.step}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
