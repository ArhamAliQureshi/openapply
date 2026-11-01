import "server-only";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { step, track } from "@/lib/activity";
import { getState, runFeed, setState, type FeedRunSummary } from "@/lib/feed/run";
import { getProfile, planFromUrl, runApplication } from "./service";

// The daily loop: refresh the feed, then plan and fill the best new matches up to the daily limit.
// Anything that needs a human (unanswered questions, CAPTCHA, verification code) is left in "needs you".

export type AutopilotSummary = {
  at: string;
  mode: "dry_run" | "live";
  feed: FeedRunSummary | { error: string } | null;
  considered: number;
  submitted: number;
  dryRuns: number;
  needsYou: number;
  failed: number;
  skipped: number;
  items: { company: string; title: string; outcome: string; applicationId?: string }[];
};

const FILLED_STATUSES = ["submitted", "dry_run_done", "blocked", "failed", "filling"];
// Kept on globalThis: Next may load each route handler as a separate module instance.
const lock = globalThis as { __autopilotRun?: Promise<AutopilotSummary> | null };

/** Runs once; concurrent callers share the same run. */
export function runAutopilot(opts: { refreshFeed?: boolean } = {}): Promise<AutopilotSummary> {
  lock.__autopilotRun ??= doRun(opts).finally(() => {
    lock.__autopilotRun = null;
  });
  return lock.__autopilotRun;
}

export const autopilotRunning = () => !!lock.__autopilotRun;

function doRun(opts: { refreshFeed?: boolean }): Promise<AutopilotSummary> {
  return track("autopilot", "Autopilot run", async (ctx) => {
    const s = await runSteps(opts);
    ctx.result(`${s.mode === "live" ? "live" : "dry run"}: ${s.submitted} submitted, ${s.dryRuns} dry runs, ${s.needsYou} need you, ${s.failed} failed, ${s.skipped} skipped`);
    return s;
  });
}

async function runSteps({ refreshFeed = true }: { refreshFeed?: boolean }): Promise<AutopilotSummary> {
  const profile = await getProfile();
  const { mode, dailyLimit, minScore } = profile.autopilot;
  const live = mode === "live" && process.env.ALLOW_LIVE_SUBMIT === "true";
  const summary: AutopilotSummary = {
    at: new Date().toISOString(),
    mode: live ? "live" : "dry_run",
    feed: null,
    considered: 0,
    submitted: 0,
    dryRuns: 0,
    needsYou: 0,
    failed: 0,
    skipped: 0,
    items: [],
  };

  if (refreshFeed) {
    step("Refreshing the job feed");
    summary.feed = await runFeed().catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
  }

  const db = await getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [{ n: usedToday }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.applications)
    .where(and(gte(schema.applications.updatedAt, startOfDay), inArray(schema.applications.status, FILLED_STATUSES)));
  let budget = Math.max(0, dailyLimit - usedToday);

  // Companies applied to (for real) in the last 30 days are skipped.
  const recent = await db
    .select({ company: schema.jobs.company, board: schema.jobs.board })
    .from(schema.applications)
    .innerJoin(schema.jobs, eq(schema.applications.jobId, schema.jobs.id))
    .where(and(eq(schema.applications.status, "submitted"), gte(schema.applications.submittedAt, new Date(Date.now() - 30 * 86_400_000))));
  const recentBoards = new Set(recent.map((r) => r.board.toLowerCase()));

  const candidates = await db
    .select({
      id: schema.feedJobs.id,
      board: schema.feedJobs.board,
      company: schema.feedJobs.company,
      title: schema.feedJobs.title,
      applyUrl: schema.feedJobs.applyUrl,
    })
    .from(schema.feedJobs)
    .where(and(eq(schema.feedJobs.status, "new"), gte(schema.feedJobs.score, minScore)))
    .orderBy(desc(schema.feedJobs.score))
    .limit(dailyLimit * 3);

  for (const job of candidates) {
    if (budget <= 0) break;
    summary.considered++;
    step(`Job ${summary.considered} (${budget} left today): ${job.company} — ${job.title}`);
    const record = (outcome: string, applicationId?: string) =>
      summary.items.push({ company: job.company, title: job.title, outcome, applicationId });

    if (recentBoards.has(job.board.toLowerCase())) {
      await db.update(schema.feedJobs).set({ status: "skipped", note: "Applied to this company in the last 30 days" }).where(eq(schema.feedJobs.id, job.id));
      summary.skipped++;
      record("skipped: applied to this company recently");
      continue;
    }

    let applicationId: string;
    try {
      applicationId = await planFromUrl(job.applyUrl);
    } catch (err) {
      await db.update(schema.feedJobs).set({ status: "skipped", note: err instanceof Error ? err.message : "Could not read form" }).where(eq(schema.feedJobs.id, job.id));
      summary.failed++;
      record("could not read form");
      continue;
    }

    const [app] = await db
      .select({ status: schema.applications.status, plan: schema.applications.plan })
      .from(schema.applications)
      .where(eq(schema.applications.id, applicationId));
    if (app.status === "needs_input") {
      await db.update(schema.feedJobs).set({ status: "needs_you", applicationId }).where(eq(schema.feedJobs.id, job.id));
      summary.needsYou++;
      record(`needs you: ${app.plan.missing.length} question(s)`, applicationId);
      continue;
    }

    budget--;
    const result = await runApplication(applicationId, live).catch((err) => ({
      outcome: "failed" as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    const feedStatus =
      result.outcome === "submitted" ? "applied" : result.outcome === "dry_run_done" ? "dry_run" : result.outcome === "blocked" ? "needs_you" : "failed";
    await db.update(schema.feedJobs).set({ status: feedStatus, applicationId }).where(eq(schema.feedJobs.id, job.id));
    if (result.outcome === "submitted") {
      summary.submitted++;
      recentBoards.add(job.board.toLowerCase());
    } else if (result.outcome === "dry_run_done") summary.dryRuns++;
    else if (result.outcome === "blocked") summary.needsYou++;
    else summary.failed++;
    record(result.outcome + ("error" in result && result.error ? `: ${result.error}` : ""), applicationId);
  }

  step("Saving results");
  await setState("lastAutopilotRun", summary);
  return summary;
}

/** Called hourly by the scheduler: runs once per day after the configured hour, if enabled. */
export async function runAutopilotIfDue() {
  const profile = await getProfile();
  if (!profile.autopilot.enabled || autopilotRunning()) return;
  const now = new Date();
  if (now.getHours() < profile.autopilot.runAfterHour) return;
  const last = await getState<AutopilotSummary>("lastAutopilotRun");
  if (last && new Date(last.at).toDateString() === now.toDateString()) return;
  const summary = await runAutopilot();
  console.log(
    `[autopilot] ${summary.mode}: ${summary.submitted} submitted, ${summary.dryRuns} dry runs, ${summary.needsYou} need you, ${summary.failed} failed`,
  );
}
