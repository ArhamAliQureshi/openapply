import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ApplicationPlan } from "@/lib/apply/types";
import type { Profile } from "@/lib/profile-schema";
import type { Resume } from "@/lib/resume-schema";

export const resumes = pgTable(
  "resumes",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  // Base resume this one was tailored from (used by Application Kit later).
  parentId: uuid("parent_id"),
  sourceFilename: text("source_filename"),
  sourceText: text("source_text"),
  template: text("template").notNull().default("classic"),
  data: jsonb("data").$type<Resume>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("resumes_updated_at_idx").on(t.updatedAt)],
);

export type ResumeRow = typeof resumes.$inferSelect;

// Single-user app: one profile row with id "me".
export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  data: jsonb("data").$type<Profile>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Answers to form questions, reused across applications. `key` is the normalized question text.
export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("answers_key_idx").on(t.key)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(), // "greenhouse" | "lever" | "ashby" | ...
    board: text("board").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    applyUrl: text("apply_url").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location").notNull(),
    raw: jsonb("raw").$type<unknown>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("jobs_source_board_external_idx").on(t.source, t.board, t.externalId)],
);

export const applications = pgTable(
  "applications",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  // planned → needs_input | ready → filling → dry_run_done | submitted | failed | blocked
  status: text("status").notNull(),
  plan: jsonb("plan").$type<ApplicationPlan>().notNull(),
  log: jsonb("log").$type<string[]>().notNull().default([]),
  screenshotPath: text("screenshot_path"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  },
  (t) => [
    // Applications list (newest first) and autopilot's daily-cap / 30-day checks.
    index("applications_updated_at_idx").on(t.updatedAt),
    index("applications_status_updated_at_idx").on(t.status, t.updatedAt),
    index("applications_job_id_idx").on(t.jobId),
  ],
);

export type JobRow = typeof jobs.$inferSelect;
export type ApplicationRow = typeof applications.$inferSelect;
export type AnswerRow = typeof answers.$inferSelect;

// Jobs found by the daily feed (not yet applied to). Applying creates a `jobs` + `applications` row.
export const feedJobs = pgTable(
  "feed_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    board: text("board").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    applyUrl: text("apply_url").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location").notNull(),
    remote: boolean("remote").notNull().default(false),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    score: integer("score").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    // new → queued (application created) → applied | dry_run | needs_you ; or skipped / dismissed / closed
    status: text("status").notNull().default("new"),
    applicationId: uuid("application_id"),
    note: text("note"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("feed_jobs_source_board_external_idx").on(t.source, t.board, t.externalId),
    // Jobs page tabs and autopilot candidates: filter by status, best score first.
    index("feed_jobs_status_score_idx").on(t.status, t.score.desc()),
    // Closing jobs no longer seen on their board.
    index("feed_jobs_status_last_seen_idx").on(t.status, t.lastSeenAt),
  ],
);

// Company boards discovered through aggregators, kept between runs.
export const feedCompanies = pgTable(
  "feed_companies",
  {
    source: text("source").notNull(),
    board: text("board").notNull(),
    company: text("company").notNull(),
    via: text("via").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("feed_companies_idx").on(t.source, t.board)],
);

// Small key/value store for run bookkeeping (last feed run, last autopilot summary).
export const appState = pgTable("app_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeedJobRow = typeof feedJobs.$inferSelect;
