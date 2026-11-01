"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AutopilotSummary } from "@/lib/apply/autopilot";
import type { FeedRunSummary } from "@/lib/feed/run";
import type { Autopilot, Profile } from "@/lib/profile-schema";
import { useSingleFlight } from "@/lib/use-single-flight";

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

const toList = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const timeAgo = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
};

export function AutopilotPanel(props: {
  feed: Profile["feed"];
  autopilot: Autopilot;
  lastFeed: FeedRunSummary | null;
  lastRun: AutopilotSummary | null;
  running: boolean;
  liveAllowed: boolean;
}) {
  const router = useRouter();
  const [feed, setFeed] = useState(props.feed);
  const [titles, setTitles] = useState(props.feed.titles.join(", "));
  const [locations, setLocations] = useState(props.feed.locations.join(", "));
  const [excludeCompanies, setExcludeCompanies] = useState(props.feed.excludeCompanies.join(", "));
  const [excludeKeywords, setExcludeKeywords] = useState(props.feed.excludeKeywords.join(", "));
  const [ap, setAp] = useState(props.autopilot);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(props.running);
  const saving = useSingleFlight();
  const refreshing = useSingleFlight();
  const starting = useSingleFlight();

  // While a run is in progress, refresh the page every 10s to show results as they land.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(async () => {
      const { running } = await fetch("/api/autopilot/run").then((r) => r.json());
      router.refresh();
      if (!running) {
        setBusy(false);
        setStatus("Run finished.");
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [busy, router]);

  async function save() {
    const nextFeed = {
      ...feed,
      titles: toList(titles),
      locations: toList(locations),
      excludeCompanies: toList(excludeCompanies),
      excludeKeywords: toList(excludeKeywords),
    };
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feed: nextFeed, autopilot: ap }),
    });
    setStatus(res.ok ? "Saved." : "Couldn't save settings.");
    return res.ok;
  }

  async function refreshFeed() {
    if (!(await save())) return;
    setStatus("Collecting jobs from ~250 company career pages (about a minute)…");
    const res = await fetch("/api/feed/run", { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setStatus(res.ok ? `Found ${json.matched} matching jobs (${json.newJobs} new).` : (json.error ?? "Feed failed."));
    router.refresh();
  }

  async function runNow() {
    if (!(await save())) return;
    const res = await fetch("/api/autopilot/run", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const json = await res.json();
    setBusy(true);
    setStatus(json.started ? "Autopilot started: refreshing jobs, then filling applications…" : json.message);
  }

  const run = props.lastRun;
  return (
    <section className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-sm font-semibold">What you&apos;re looking for</h2>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600">Job titles (comma separated)</span>
          <input className={inputCls} value={titles} placeholder="Software Engineer, Backend Engineer" onChange={(e) => setTitles(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-neutral-600">Locations</span>
          <input className={inputCls} value={locations} placeholder="London, United Kingdom, Dubai" onChange={(e) => setLocations(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={feed.remoteOk} onChange={(e) => setFeed({ ...feed, remoteOk: e.target.checked })} />
            Remote
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={feed.onsiteOk} onChange={(e) => setFeed({ ...feed, onsiteOk: e.target.checked })} />
            On-site / hybrid
          </label>
          <label className="flex items-center gap-2">
            Posted within
            <input
              type="number"
              min={1}
              max={365}
              className={`${inputCls} w-16`}
              value={feed.maxAgeDays}
              onChange={(e) => setFeed({ ...feed, maxAgeDays: Number(e.target.value) || 14 })}
            />
            days
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Skip companies</span>
            <input className={inputCls} value={excludeCompanies} onChange={(e) => setExcludeCompanies(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Skip titles containing</span>
            <input className={inputCls} value={excludeKeywords} onChange={(e) => setExcludeKeywords(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-neutral-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Autopilot</h2>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={ap.enabled} onChange={(e) => setAp({ ...ap, enabled: e.target.checked })} />
            Run daily
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Mode</span>
            <select className={inputCls} value={ap.mode} onChange={(e) => setAp({ ...ap, mode: e.target.value as Autopilot["mode"] })}>
              <option value="dry_run">Dry run (fill, don&apos;t submit)</option>
              <option value="live" disabled={!props.liveAllowed}>
                Live (submit applications){props.liveAllowed ? "" : " — enable ALLOW_LIVE_SUBMIT"}
              </option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Applications per day</span>
            <input type="number" min={1} max={200} className={inputCls} value={ap.dailyLimit} onChange={(e) => setAp({ ...ap, dailyLimit: Number(e.target.value) || 1 })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Minimum match score</span>
            <input type="number" min={0} max={100} className={inputCls} value={ap.minScore} onChange={(e) => setAp({ ...ap, minScore: Number(e.target.value) || 0 })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-600">Start after (hour, 0–23)</span>
            <input type="number" min={0} max={23} className={inputCls} value={ap.runAfterHour} onChange={(e) => setAp({ ...ap, runAfterHour: Number(e.target.value) || 0 })} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => saving.run(save)}
            disabled={saving.pending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {saving.pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => refreshing.run(refreshFeed)}
            disabled={busy || refreshing.pending}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
          >
            {refreshing.pending ? "Refreshing…" : "Refresh jobs"}
          </button>
          <button
            type="button"
            onClick={() => starting.run(runNow)}
            disabled={busy || starting.pending || refreshing.pending}
            className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {busy ? "Running…" : "Run autopilot now"}
          </button>
        </div>
        {status && <p className="text-sm text-neutral-700">{status}</p>}
        <div className="space-y-1 border-t border-neutral-100 pt-3 text-xs text-neutral-600">
          {props.lastFeed && (
            <p>
              Jobs refreshed {timeAgo(props.lastFeed.at)}: {props.lastFeed.stats.totalFetched.toLocaleString()} open roles from{" "}
              {props.lastFeed.stats.boardsQueried} companies, {props.lastFeed.matched} match.
            </p>
          )}
          {run && (
            <p>
              Last autopilot run {timeAgo(run.at)} ({run.mode === "live" ? "live" : "dry run"}): {run.submitted} submitted, {run.dryRuns} dry runs,{" "}
              {run.needsYou} need you, {run.failed} failed, {run.skipped} skipped.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
