import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";

const Body = z.object({ answer: z.string().trim().min(1).max(5000) });

export async function PUT(request: Request, ctx: RouteContext<"/api/answers/[id]">) {
  const { id } = await ctx.params;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const db = await getDb();
  await db.update(schema.answers).set({ answer: parsed.data.answer, updatedAt: new Date() }).where(eq(schema.answers.id, id));
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/answers/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });
  const db = await getDb();
  await db.delete(schema.answers).where(eq(schema.answers.id, id));
  return new Response(null, { status: 204 });
}
