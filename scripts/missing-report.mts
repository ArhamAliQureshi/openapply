// Dev helper: most common unanswered questions across applications that need input.
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

const db = await getDb();
const apps = await db.select().from(schema.applications).where(eq(schema.applications.status, "needs_input"));
const counts = new Map<string, number>();
for (const a of apps) for (const m of a.plan.missing) counts.set(m.label.slice(0, 110), (counts.get(m.label.slice(0, 110)) ?? 0) + 1);
console.log(`${apps.length} applications need input; ${counts.size} distinct questions`);
[...counts].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([q, n]) => console.log(`${n}× ${q}`));
process.exit(0);
