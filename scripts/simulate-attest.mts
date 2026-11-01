// Dev helper: measure how many questions "auto-accept certifications" would answer, then restore the setting.
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { planApplication } from "@/lib/apply/plan";
import { getProfile } from "@/lib/apply/service";
import { ADAPTERS } from "@/lib/apply/sources";

const profile = { ...(await getProfile()), autoAcceptAttestations: true };
const db = await getDb();
const lib = new Map((await db.select().from(schema.answers)).map((a) => [a.key, a.answer]));
const rows = await db
  .select({ app: schema.applications, job: schema.jobs })
  .from(schema.applications)
  .innerJoin(schema.jobs, eq(schema.applications.jobId, schema.jobs.id))
  .where(eq(schema.applications.status, "needs_input"));
let total = 0;
for (const { app, job } of rows) {
  const info = ADAPTERS[job.source].info(job.raw);
  const plan = planApplication(info.fields, profile, lib, { company: info.company, jobLocation: info.location });
  const accepted = plan.answers.filter((a) => a.source === "rule" && !app.plan.answers.some((b) => b.fieldId === a.fieldId));
  total += plan.missing.length;
  console.log(`${job.company}: ${app.plan.missing.length} → ${plan.missing.length}${accepted.length ? ` (auto-accepted: ${accepted.map((a) => a.label.slice(0, 50)).join(" | ")})` : ""}`);
}
console.log(`Total with auto-accept: ${total}`);
process.exit(0);
