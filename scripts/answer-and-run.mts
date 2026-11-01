// Dev helper: answer missing questions for the newest application, re-plan, then dry-run it.
// Usage: npx tsx --env-file=.env.local --conditions=react-server scripts/answer-and-run.mts "<answer>"
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { replan, runApplication, saveAnswer } from "@/lib/apply/service";

const answer = process.argv[2];
const db = await getDb();
const [app] = await db.select().from(schema.applications).orderBy(desc(schema.applications.createdAt)).limit(1);
for (const m of app.plan.missing) {
  console.log(`Answering "${m.label.slice(0, 60)}…" with "${answer}"`);
  await saveAnswer(m.label, answer);
}
await replan(app.id);
const r = await runApplication(app.id, false);
console.log(`Dry run: ${r.outcome} ${r.error ?? ""}`);
r.log.filter((l) => !l.startsWith("✓")).forEach((l) => console.log("  " + l));
console.log(`  ${r.log.filter((l) => l.startsWith("✓")).length} fields filled. Screenshot: ${r.screenshotPath}`);
process.exit(0);
