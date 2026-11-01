// Dev helper: delete all personal/test data (profile, resumes, answers, jobs, applications, feed matches,
// run history). Keeps discovered company boards. Usage: ... scripts/reset-data.mts --yes
import { getDb, schema } from "@/db";

if (!process.argv.includes("--yes")) throw new Error("Pass --yes to delete all data.");
const db = await getDb();
await db.delete(schema.applications);
await db.delete(schema.jobs);
await db.delete(schema.feedJobs);
await db.delete(schema.answers);
await db.delete(schema.profiles);
await db.delete(schema.resumes);
await db.delete(schema.appState);
console.log("Deleted profile, resumes, answers, jobs, applications, feed matches and run history.");
process.exit(0);
