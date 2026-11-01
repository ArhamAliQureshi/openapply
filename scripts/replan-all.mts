// Dev helper: re-plan every application that needs input and report how many questions remain.
// Usage: npx tsx --env-file=.env.local --conditions=react-server scripts/replan-all.mts [--seed-sample]
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getProfile, replan, saveProfile } from "@/lib/apply/service";

if (process.argv.includes("--seed-sample")) {
  const p = await getProfile();
  await saveProfile({ ...p, pastEmployers: ["Stripe", "Airbnb", "Infosys"], citizenships: ["United States"], securityClearance: "None", noticePeriod: "2 weeks" });
}
const db = await getDb();
const apps = await db
  .select({ id: schema.applications.id, plan: schema.applications.plan, company: schema.jobs.company })
  .from(schema.applications)
  .innerJoin(schema.jobs, eq(schema.applications.jobId, schema.jobs.id))
  .where(eq(schema.applications.status, "needs_input"));
let before = 0;
let after = 0;
for (const a of apps) {
  before += a.plan.missing.length;
  await replan(a.id);
  const [r] = await db.select().from(schema.applications).where(eq(schema.applications.id, a.id));
  after += r.plan.missing.length;
  console.log(`${a.company}: ${a.plan.missing.length} → ${r.plan.missing.length} missing (${r.status})`);
}
console.log(`Total unanswered: ${before} → ${after}`);
process.exit(0);
