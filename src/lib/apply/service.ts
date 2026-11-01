import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { step, track } from "@/lib/activity";
import { singleFlight } from "@/lib/single-flight";
import { generateText } from "@/lib/ai-text";
import { emptyProfile, ProfileSchema, type Profile } from "@/lib/profile-schema";
import { genericQuestionKey, planApplication, questionKey } from "./plan";
import { ADAPTERS, SUPPORTED_HINT, type JobInfo, type StoredJob } from "./sources";
import type { ApplicationPlan, FormField } from "./types";

export class ApplyError extends Error {}

const PROFILE_ID = "me";

export async function getProfile(): Promise<Profile> {
  const db = await getDb();
  const [row] = await db.select({ data: schema.profiles.data }).from(schema.profiles).where(eq(schema.profiles.id, PROFILE_ID));
  // Merge with defaults so profiles saved before a field existed still validate.
  return row ? ProfileSchema.parse({ ...emptyProfile(), ...row.data }) : emptyProfile();
}

export async function saveProfile(data: Profile) {
  const db = await getDb();
  await db
    .insert(schema.profiles)
    .values({ id: PROFILE_ID, data })
    .onConflictDoUpdate({ target: schema.profiles.id, set: { data, updatedAt: new Date() } });
}

/** Saves an answer for reuse. With a company, it's stored company-neutral ("worked for the company before?"). */
export async function saveAnswer(question: string, answer: string, company = "") {
  const db = await getDb();
  const key = company ? genericQuestionKey(question, company) : questionKey(question);
  await db
    .insert(schema.answers)
    .values({ key, question, answer })
    .onConflictDoUpdate({ target: schema.answers.key, set: { answer, question, updatedAt: new Date() } });
}

async function loadLibrary(): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.select({ key: schema.answers.key, answer: schema.answers.answer }).from(schema.answers);
  return new Map(rows.map((r) => [r.key, r.answer]));
}

const AI_SYSTEM = `You write short answers to job application questions on behalf of the candidate.
Rules:
- First person, 60–120 words, plain text, no headings or bullet points.
- Use only facts from the candidate background and the job description. Never invent experience, numbers or employers.
- Be specific to this company and role; avoid clichés like "I am passionate" or "dream job".
- No placeholders such as [Company] — write the final text.
- If the question asks for a fact that is not in the background (citizenship, dates, clearance, references…), reply with exactly UNKNOWN.`;

async function writeAnswers(fields: FormField[], profile: Profile, job: JobInfo) {
  const background = [
    profile.aboutMe,
    profile.currentTitle && `Current role: ${profile.currentTitle}${profile.currentCompany ? ` at ${profile.currentCompany}` : ""}`,
    profile.location && `Location: ${profile.location}`,
  ]
    .filter(Boolean)
    .join("\n");
  const description = job.description.slice(0, 6000);
  const results: { field: FormField; text: string }[] = [];
  for (const field of fields) {
    const text = await track("ai", `Writing answer: ${field.label.slice(0, 80)}`, () => generateText(
      AI_SYSTEM,
      `<company>${job.company}</company>\n<role>${job.title}</role>\n<job_description>\n${description}\n</job_description>\n<candidate_background>\n${background}\n</candidate_background>\n\nQuestion: ${field.label}`,
    ));
    if (text && !/^unknown\b/i.test(text)) results.push({ field, text });
  }
  return results;
}

async function buildPlan(job: JobInfo, profile: Profile): Promise<ApplicationPlan> {
  const { needsAi, ...plan } = planApplication(job.fields, profile, await loadLibrary(), {
    company: job.company,
    jobLocation: job.location,
  });

  // AI-written answers need some real background to stay honest.
  const canWrite = profile.aboutMe.trim().length >= 40;
  if (needsAi.length && !canWrite) {
    for (const f of needsAi) {
      plan.missing.push({
        fieldId: f.id,
        label: f.label,
        kind: f.kind,
        required: f.required,
        options: [],
        reason: "Add an 'About me' paragraph on your profile so the AI can write this, or answer it yourself.",
      });
    }
  } else if (needsAi.length) {
    try {
      const written = await writeAnswers(needsAi, profile, job);
      for (const { field, text } of written) {
        plan.answers.push({ fieldId: field.id, label: field.label, kind: field.kind, value: text, source: "ai" });
      }
      // Questions the AI wouldn't answer from the background go to the user.
      for (const f of needsAi.filter((f) => !written.some((w) => w.field.id === f.id))) {
        plan.missing.push({
          fieldId: f.id,
          label: f.label,
          kind: f.kind,
          required: f.required,
          options: [],
          reason: "Your profile doesn't contain the facts needed to answer this.",
        });
      }
    } catch (err) {
      for (const f of needsAi) {
        plan.missing.push({
          fieldId: f.id,
          label: f.label,
          kind: f.kind,
          required: f.required,
          options: [],
          reason: `AI couldn't write this (${err instanceof Error ? err.message : "error"}). Answer it yourself.`,
        });
      }
    }
  }
  return plan;
}

const statusFor = (plan: ApplicationPlan) => (plan.missing.length ? "needs_input" : "ready");

/** Reads a job link, stores the job, and plans its application. Returns the application id. */
export function planFromUrl(url: string): Promise<string> {
  return singleFlight(`plan:${url.trim()}`, () =>
    track("plan", `Reading application form: ${url.replace(/^https?:\/\//, "").slice(0, 70)}`, () => planFromUrlInner(url)),
  );
}

async function planFromUrlInner(url: string): Promise<string> {
  step("Downloading the job and its form");
  let values: StoredJob | null = null;
  for (const adapter of Object.values(ADAPTERS)) {
    values = await adapter.load(url);
    if (values) break;
  }
  if (!values) throw new ApplyError(`Unsupported job link. ${SUPPORTED_HINT}`);
  const profile = await getProfile();
  const db = await getDb();

  const [jobRow] = await db
    .insert(schema.jobs)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.jobs.source, schema.jobs.board, schema.jobs.externalId],
      set: { ...values, fetchedAt: new Date() },
    })
    .returning({ id: schema.jobs.id });

  step(`Planning answers for ${values.company} — ${values.title}`);
  const plan = await buildPlan(ADAPTERS[values.source].info(values.raw), profile);
  const [app] = await db
    .insert(schema.applications)
    .values({ jobId: jobRow.id, status: statusFor(plan), plan })
    .returning({ id: schema.applications.id });
  return app.id;
}

const adapterFor = (source: string) => {
  const adapter = ADAPTERS[source];
  if (!adapter) throw new ApplyError(`No filler for ${source} jobs yet.`);
  return adapter;
};

async function loadApplication(id: string) {
  const db = await getDb();
  const [row] = await db
    .select({ app: schema.applications, job: schema.jobs })
    .from(schema.applications)
    .innerJoin(schema.jobs, eq(schema.applications.jobId, schema.jobs.id))
    .where(eq(schema.applications.id, id));
  if (!row) throw new ApplyError("Application not found.");
  return row;
}

export async function applicationCompany(id: string) {
  return (await loadApplication(id)).job.company;
}

/** Re-plans after the user updated their profile or answered missing questions. */
export async function replan(id: string) {
  const { app, job } = await loadApplication(id);
  if (app.status === "submitted") throw new ApplyError("Already submitted.");
  const plan = await buildPlan(adapterFor(job.source).info(job.raw), await getProfile());
  const db = await getDb();
  await db
    .update(schema.applications)
    .set({ plan, status: statusFor(plan), updatedAt: new Date() })
    .where(eq(schema.applications.id, id));
}

/** Fills the form headlessly. Live submission also requires ALLOW_LIVE_SUBMIT=true. */
export function runApplication(id: string, live: boolean) {
  // Never fill the same application twice at once (double click, two tabs, autopilot + manual).
  return singleFlight(`fill:${id}`, () => runTracked(id, live));
}

async function runTracked(id: string, live: boolean) {
  const { job } = await loadApplication(id);
  return track("fill", `${live ? "Submitting" : "Dry run"}: ${job.company} — ${job.title}`, async (ctx) => {
    const result = await runApplicationInner(id, live);
    ctx.result(result.outcome + (result.error ? `: ${result.error}` : ""));
    return result;
  });
}

async function runApplicationInner(id: string, live: boolean) {
  const { app, job } = await loadApplication(id);
  if (app.status === "submitted") throw new ApplyError("Already submitted.");
  if (app.plan.missing.length) throw new ApplyError("Answer the missing questions first.");
  if (live && process.env.ALLOW_LIVE_SUBMIT !== "true") {
    throw new ApplyError("Live submission is off. Set ALLOW_LIVE_SUBMIT=true in .env.local to enable it.");
  }

  const db = await getDb();
  await db.update(schema.applications).set({ status: "filling", updatedAt: new Date() }).where(eq(schema.applications.id, id));

  step("Opening the form in a hidden browser");
  const fill = adapterFor(job.source).fill;
  const result = await fill({
    applicationId: id,
    applyUrl: job.applyUrl,
    answers: app.plan.answers,
    profile: await getProfile(),
    live,
  }).catch((err): Awaited<ReturnType<typeof fill>> => ({
    outcome: "failed",
    log: [],
    screenshotPath: "",
    error: err instanceof Error ? err.message.split("\n")[0] : String(err),
  }));
  await db
    .update(schema.applications)
    .set({
      status: result.outcome,
      log: result.log,
      screenshotPath: result.screenshotPath || null,
      error: result.error ?? null,
      updatedAt: new Date(),
      submittedAt: result.outcome === "submitted" ? new Date() : null,
    })
    .where(eq(schema.applications.id, id));
  return result;
}
