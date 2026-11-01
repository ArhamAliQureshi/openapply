// Dev helper: row counts per table and a peek at the profile name.
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getProfile } from "@/lib/apply/service";

const db = await getDb();
const count = async (t: Parameters<ReturnType<typeof db.select>["from"]>[0]) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(t))[0].n;
const p = await getProfile();
console.log("profile:", JSON.stringify({ name: `${p.firstName} ${p.lastName}`, email: p.email, resumeFile: p.resumeFile?.filename ?? null, titles: p.feed.titles }));
for (const [name, t] of Object.entries({
  resumes: schema.resumes, profiles: schema.profiles, answers: schema.answers, jobs: schema.jobs,
  applications: schema.applications, feed_jobs: schema.feedJobs, feed_companies: schema.feedCompanies, app_state: schema.appState,
})) console.log(`${name}: ${await count(t)}`);
const titles = await db.select({ t: schema.resumes.title }).from(schema.resumes);
console.log("resume titles:", titles.map((r) => r.t).join(" | "));
process.exit(0);
