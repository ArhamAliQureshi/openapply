import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";

export async function GET(_request: Request, ctx: RouteContext<"/api/applications/[id]/screenshot">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const db = await getDb();
  const [row] = await db
    .select({ path: schema.applications.screenshotPath })
    .from(schema.applications)
    .where(eq(schema.applications.id, id));
  if (!row?.path) return new Response(null, { status: 404 });
  const image = await readFile(row.path).catch(() => null);
  if (!image) return new Response(null, { status: 404 });
  // New screenshots are WebP; older ones may still be PNG.
  const type = row.path.endsWith(".webp") ? "image/webp" : "image/png";
  return new Response(new Uint8Array(image), { headers: { "content-type": type, "cache-control": "no-store" } });
}
