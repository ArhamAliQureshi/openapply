import { asc } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { saveAnswer } from "@/lib/apply/service";
import { pageFrom } from "@/lib/paginate";

export async function GET(request: Request) {
  const { limit, offset } = pageFrom(new URL(request.url).searchParams);
  const db = await getDb();
  const rows = await db
    .select({ id: schema.answers.id, question: schema.answers.question, answer: schema.answers.answer })
    .from(schema.answers)
    .orderBy(asc(schema.answers.question))
    .limit(limit)
    .offset(offset);
  return Response.json(rows);
}

const Body = z.object({ question: z.string().trim().min(1).max(2000), answer: z.string().trim().min(1).max(5000) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Question and answer are required." }, { status: 400 });
  await saveAnswer(parsed.data.question, parsed.data.answer);
  return Response.json({ ok: true }, { status: 201 });
}
