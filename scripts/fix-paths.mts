// One-off: rewrite absolute file paths stored in the database after the project folder moved.
// Usage: npx tsx --env-file=.env.local --conditions=react-server scripts/fix-paths.mts <old-root> <new-root>
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error("Pass <old-root> <new-root>");
const db = await getDb();
const swap = (col: string) => sql.raw(`replace(${col}::text, '${from.replace(/'/g, "''")}', '${to.replace(/'/g, "''")}')`);
const p = await db.update(schema.profiles).set({ data: sql`${swap("data")}::jsonb` }).returning({ id: schema.profiles.id });
const a = await db
  .update(schema.applications)
  .set({ plan: sql`${swap("plan")}::jsonb`, screenshotPath: sql`${swap("screenshot_path")}` })
  .returning({ id: schema.applications.id });
console.log(`Updated ${p.length} profile row(s), ${a.length} application row(s).`);
const [row] = await db.select().from(schema.profiles);
console.log("resume file now:", row?.data.resumeFile?.path ?? "(none)");
process.exit(0);
