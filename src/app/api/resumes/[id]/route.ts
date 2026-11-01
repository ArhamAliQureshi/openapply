import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { ResumeSchema } from "@/lib/resume-schema";
import { TEMPLATES } from "@/lib/templates";

const UpdateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  template: z.enum(TEMPLATES).optional(),
  data: ResumeSchema.optional(),
});

const IdSchema = z.uuid();

export async function PUT(request: Request, ctx: RouteContext<"/api/resumes/[id]">) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });

  const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid resume data." }, { status: 400 });

  const db = await getDb();
  const [row] = await db
    .update(schema.resumes)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(schema.resumes.id, id))
    .returning({ updatedAt: schema.resumes.updatedAt });
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ updatedAt: row.updatedAt });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/resumes/[id]">) {
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });
  const db = await getDb();
  await db.delete(schema.resumes).where(eq(schema.resumes.id, id));
  return new Response(null, { status: 204 });
}
