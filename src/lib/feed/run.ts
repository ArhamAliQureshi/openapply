import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { step, track } from "@/lib/activity";
import { singleFlight } from "@/lib/single-flight";
import { getProfile } from "@/lib/apply/service";
import { collectJobs, type CompanyList, type FeedStats } from "./index";

export type FeedRunSummary = {
  at: string;
  stats: Omit<FeedStats, "failures"> & { failureCount: number };
  matched: number;
  newJobs: number;
  newCompanies: number;
};

export async function getState<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const [row] = await db.select({ value: schema.appState.value }).from(schema.appState).where(eq(schema.appState.key, key));
  return (row?.value as T) ?? null;
}

export async function setState(key: string, value: unknown) {
  const db = await getDb();
  await db
    .insert(schema.appState)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.appState.key, set: { value, updatedAt: new Date() } });
}

/** Collects jobs for the profile's preferences and stores the matches. */
export function runFeed(): Promise<FeedRunSummary> {
  // One feed refresh at a time; a second request waits for the running one.
  return singleFlight("feed", () =>
    track("feed", "Job feed refresh", async (ctx) => {
      const summary = await collectAndStore();
      ctx.result(`${summary.matched} matching jobs (${summary.newJobs} new) from ${summary.stats.boardsQueried} companies`);
      return summary;
    }),
  );
}

async function collectAndStore(): Promise<FeedRunSummary> {
  const profile = await getProfile();
  if (!profile.feed.titles.length) throw new Error("Add at least one target job title on the Jobs page first.");
  const db = await getDb();

  const saved = await db.select({ source: schema.feedCompanies.source, board: schema.feedCompanies.board }).from(schema.feedCompanies);
  const extraCompanies: Partial<CompanyList> = {};
  for (const c of saved) (extraCompanies[c.source as keyof CompanyList] ??= []).push(c.board);

  const profileText = [profile.currentTitle, profile.aboutMe].join("\n");
  step(`Collecting open jobs from ${Object.values(extraCompanies).flat().length + 250}+ company career pages…`);
  const { listings, stats, newCompanies } = await collectJobs(profile.feed, { extraCompanies, profileText });

  if (newCompanies.length) {
    await db.insert(schema.feedCompanies).values(newCompanies).onConflictDoNothing();
  }

  step(`Saving ${listings.length} matching jobs…`);
  const before = await db.select({ n: sql<number>`count(*)::int` }).from(schema.feedJobs);
  const now = new Date();
  // Upsert in chunks; keep a job's status (e.g. applied/dismissed) when it's seen again.
  for (let i = 0; i < listings.length; i += 200) {
    const rows = listings.slice(i, i + 200).map((l) => ({
      source: l.source,
      board: l.board,
      externalId: l.externalId,
      url: l.url,
      applyUrl: l.applyUrl,
      title: l.title,
      company: l.company,
      location: l.location,
      remote: l.remote,
      postedAt: l.postedAt ? new Date(l.postedAt) : null,
      score: l.score,
      reasons: l.reasons,
      lastSeenAt: now,
    }));
    await db
      .insert(schema.feedJobs)
      .values(rows)
      .onConflictDoUpdate({
        target: [schema.feedJobs.source, schema.feedJobs.board, schema.feedJobs.externalId],
        set: {
          score: sql`excluded.score`,
          reasons: sql`excluded.reasons`,
          title: sql`excluded.title`,
          location: sql`excluded.location`,
          lastSeenAt: now,
        },
      });
  }
  const after = await db.select({ n: sql<number>`count(*)::int` }).from(schema.feedJobs);

  // Jobs that disappeared from their board for 3+ days are probably closed.
  await db
    .update(schema.feedJobs)
    .set({ status: "closed" })
    .where(and(eq(schema.feedJobs.status, "new"), lt(schema.feedJobs.lastSeenAt, new Date(Date.now() - 3 * 86_400_000))));

  const { failures, ...rest } = stats;
  const summary: FeedRunSummary = {
    at: now.toISOString(),
    stats: { ...rest, failureCount: failures.length },
    matched: listings.length,
    newJobs: after[0].n - before[0].n,
    newCompanies: newCompanies.length,
  };
  await setState("lastFeedRun", summary);
  return summary;
}
