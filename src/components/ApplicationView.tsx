"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApplicationPlan } from "@/lib/apply/types";
import { useSingleFlight } from "@/lib/use-single-flight";
import { StatusBadge } from "./StatusBadge";

type Props = {
  app: {
    id: string;
    status: string;
    plan: ApplicationPlan;
    log: string[];
    error: string | null;
    hasScreenshot: boolean;
    updatedAt: string;
  };
  job: { title: string; company: string; location: string; url: string };
  liveEnabled: boolean;
};

const SOURCE_LABEL: Record<string, string> = {
  profile: "Profile",
  library: "Saved answer",
  rule: "Rule",
  ai: "AI-written",
  default: "Default",
};

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

export function ApplicationView({ app, job, liveEnabled }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const flight = useSingleFlight();
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const { plan } = app;

  const act = (body: object, label: string) => flight.run(() => doAct(body, label));

  async function doAct(body: object, label: string) {
    setBusy(label);
    setError(null);
    const res = await fetch(`/api/applications/${app.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) setError(json.error ?? "Something went wrong.");
    else if (json.error) setError(json.error);
    router.refresh();
  }

  const answerMissing = () => {
    const answers = plan.missing
      .filter((m) => drafts[m.fieldId]?.trim())
      .map((m) => ({ question: m.label, answer: drafts[m.fieldId].trim() }));
    if (answers.length) act({ action: "answer", answers }, "Saving answers…");
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/apply" className="text-sm text-neutral-500 hover:text-neutral-900">← Applications</Link>
        <div className="mt-2 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{job.title}</h1>
            <p className="text-neutral-600">
              {job.company} · {job.location} ·{" "}
              <a href={job.url} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">
                job post
              </a>
            </p>
          </div>
          <StatusBadge status={app.status} />
        </div>
      </div>

      {plan.missing.length > 0 && (
        <section className="space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-5">
          <div>
            <h2 className="font-semibold">Needs you ({plan.missing.length})</h2>
            <p className="text-sm text-neutral-700">
              Required questions ApplyKit couldn&apos;t answer from your profile. Answers are saved and reused next time.
            </p>
          </div>
          {plan.missing.map((m) => (
            <div key={m.fieldId} className="space-y-1">
              <p className="text-sm font-medium">{m.label}</p>
              {m.detail && <p className="whitespace-pre-wrap text-sm text-neutral-700">{m.detail}</p>}
              <p className="text-xs text-neutral-600">{m.reason}</p>
              {m.kind === "file" ? (
                <Link href="/profile" className="text-sm text-teal-700 hover:underline">Go to profile →</Link>
              ) : m.options.length > 0 ? (
                <select
                  className={inputCls}
                  value={drafts[m.fieldId] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [m.fieldId]: e.target.value }))}
                >
                  <option value="">Choose…</option>
                  {m.options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <textarea
                  className={`${inputCls} ${m.kind === "textarea" ? "min-h-24" : "min-h-9"}`}
                  value={drafts[m.fieldId] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [m.fieldId]: e.target.value }))}
                />
              )}
            </div>
          ))}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={!!busy}
              onClick={answerMissing}
              className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            >
              Save answers
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => act({ action: "replan" }, "Re-checking…")}
              className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-60"
            >
              Re-check after profile changes
            </button>
          </div>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4">
        <button
          type="button"
          disabled={!!busy || plan.missing.length > 0 || app.status === "submitted"}
          onClick={() => act({ action: "run", live: false }, "Filling the form in a hidden browser…")}
          className="rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
        >
          Dry run (fill, don&apos;t submit)
        </button>
        <button
          type="button"
          disabled={!!busy || !liveEnabled || plan.missing.length > 0 || app.status === "submitted"}
          onClick={() => {
            if (confirm(`Submit your application to ${job.company} for real?`)) act({ action: "run", live: true }, "Submitting…");
          }}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-40"
          title={liveEnabled ? "" : "Live submission is off (ALLOW_LIVE_SUBMIT)"}
        >
          Submit for real
        </button>
        {busy && <span className="text-sm text-neutral-600">{busy}</span>}
        {!liveEnabled && <span className="text-xs text-neutral-500">Live submission is turned off.</span>}
        {(error || app.error) && <p role="alert" className="w-full text-sm text-red-600">{error ?? app.error}</p>}
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white">
        <h2 className="border-b border-neutral-200 px-4 py-3 text-sm font-semibold">
          Planned answers ({plan.answers.length})
          {plan.skipped.length > 0 && <span className="font-normal text-neutral-500"> · {plan.skipped.length} optional left blank</span>}
        </h2>
        <ul className="divide-y divide-neutral-100">
          {plan.answers.map((a) => (
            <li key={a.fieldId} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-4 px-4 py-2.5 text-sm">
              <span className="text-neutral-700">{a.label}</span>
              <span className="whitespace-pre-wrap break-words">
                {a.kind === "file" ? String(a.value).split("/").pop() : Array.isArray(a.value) ? a.value.join(", ") : a.value}
              </span>
              <span
                className={`h-fit rounded px-1.5 py-0.5 text-xs ${a.source === "ai" ? "bg-violet-100 text-violet-800" : "bg-neutral-100 text-neutral-600"}`}
              >
                {SOURCE_LABEL[a.source]}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {app.log.length > 0 && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Browser log</h2>
          <ul className="space-y-0.5 font-mono text-xs text-neutral-700">
            {app.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      )}

      {app.hasScreenshot && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Screenshot of the filled form</h2>
          {/* eslint-disable-next-line @next/next/no-img-element -- local, uncached screenshot */}
          <img
            src={`/api/applications/${app.id}/screenshot?v=${app.updatedAt}`}
            alt="Filled application form"
            loading="lazy"
            decoding="async"
            className="w-full rounded border border-neutral-200"
          />
        </section>
      )}
    </div>
  );
}
