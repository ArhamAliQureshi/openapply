import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { ApplyError, planFromUrl } from "@/lib/apply/service";

export const maxDuration = 600;

const Body = z.object({ action: z.enum(["plan", "dismiss", "restore"]) });

export async function POST(request: Request, ctx: RouteContext<"/api/feed/jobs/[id]">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const db = await getDb();
  const [job] = await db.select({ applyUrl: schema.feedJobs.applyUrl }).from(schema.feedJobs).where(eq(schema.feedJobs.id, id));
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });

  if (parsed.data.action !== "plan") {
    await db.update(schema.feedJobs).set({ status: parsed.data.action === "dismiss" ? "dismissed" : "new" }).where(eq(schema.feedJobs.id, id));
    return Response.json({ ok: true });
  }
  try {
    const applicationId = await planFromUrl(job.applyUrl);
    await db.update(schema.feedJobs).set({ status: "queued", applicationId }).where(eq(schema.feedJobs.id, id));
    return Response.json({ applicationId });
  } catch (err) {
    if (err instanceof ApplyError) return Response.json({ error: err.message }, { status: 422 });
    console.error(err);
    return Response.json({ error: "Couldn't read this job's form." }, { status: 500 });
  }
}
