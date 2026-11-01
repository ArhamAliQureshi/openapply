import { desc, inArray, sql } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutopilotPanel } from "@/components/AutopilotPanel";
import { FeedList } from "@/components/FeedList";
import { Nav } from "@/components/Nav";
import { getDb, schema } from "@/db";
import { autopilotRunning, type AutopilotSummary } from "@/lib/apply/autopilot";
import { getProfile } from "@/lib/apply/service";
import { getState, type FeedRunSummary } from "@/lib/feed/run";
import { Pager } from "@/components/Pager";
import { JobsSkeleton } from "@/components/Skeleton";
import { pageCount, pageFrom } from "@/lib/paginate";

const TABS = {
  new: ["new"],
  needs_you: ["needs_you", "queued"],
  done: ["applied", "dry_run"],
  skipped: ["skipped", "dismissed", "failed", "closed"],
} as const;

export default function JobsPage(props: PageProps<"/jobs">) {
  return (
    <>
      <Nav active="/jobs" />
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Open roles from company career pages (Greenhouse, Lever, Ashby), matched to your preferences. Autopilot applies to the best ones every day.
        </p>
        <Suspense fallback={<JobsSkeleton />}>
          <Loaded searchParams={props.searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function Loaded({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const sp = await searchParams;
  const tab = (typeof sp.tab === "string" && sp.tab in TABS ? sp.tab : "new") as keyof typeof TABS;
  const { page, limit, offset } = pageFrom(sp);
  const db = await getDb();
  const [profile, lastFeed, lastRun, counts, rows] = await Promise.all([
    getProfile(),
    getState<FeedRunSummary>("lastFeedRun"),
    getState<AutopilotSummary>("lastAutopilotRun"),
    db
      .select({ status: schema.feedJobs.status, n: sql<number>`count(*)::int` })
      .from(schema.feedJobs)
      .groupBy(schema.feedJobs.status),
    db
      // Only the columns the list shows.
      .select({
        id: schema.feedJobs.id,
        title: schema.feedJobs.title,
        company: schema.feedJobs.company,
        location: schema.feedJobs.location,
        remote: schema.feedJobs.remote,
        score: schema.feedJobs.score,
        reasons: schema.feedJobs.reasons,
        status: schema.feedJobs.status,
        url: schema.feedJobs.url,
        applicationId: schema.feedJobs.applicationId,
        note: schema.feedJobs.note,
      })
      .from(schema.feedJobs)
      .where(inArray(schema.feedJobs.status, [...TABS[tab]]))
      .orderBy(desc(schema.feedJobs.score), desc(schema.feedJobs.lastSeenAt))
      .limit(limit)
      .offset(offset),
  ]);
  const tabCounts = Object.fromEntries(
    Object.entries(TABS).map(([k, statuses]) => [
      k,
      counts.filter((c) => (statuses as readonly string[]).includes(c.status)).reduce((a, c) => a + c.n, 0),
    ]),
  );
  return (
    <div className="mt-6 space-y-6">
      <AutopilotPanel
        feed={profile.feed}
        autopilot={profile.autopilot}
        lastFeed={lastFeed}
        lastRun={lastRun}
        running={autopilotRunning()}
        liveAllowed={process.env.ALLOW_LIVE_SUBMIT === "true"}
      />
      <FeedList
        tab={tab}
        counts={tabCounts}
        jobs={rows}
      />
      <Pager page={page} pages={pageCount(tabCounts[tab])} total={tabCounts[tab]} basePath="/jobs" params={{ tab }} />
    </div>
  );
}
