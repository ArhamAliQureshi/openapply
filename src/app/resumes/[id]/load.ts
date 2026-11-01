import "server-only";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { TEMPLATES, type Template } from "@/lib/templates";

export async function loadResume(params: Promise<{ id: string }>) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getDb();
  // Skip source_text (the full extracted resume text): the editor doesn't use it.
  const [row] = await db
    .select({ id: schema.resumes.id, title: schema.resumes.title, template: schema.resumes.template, data: schema.resumes.data })
    .from(schema.resumes)
    .where(eq(schema.resumes.id, id));
  if (!row) notFound();
  const template: Template = (TEMPLATES as readonly string[]).includes(row.template)
    ? (row.template as Template)
    : "classic";
  return { ...row, template };
}
