import { z } from "zod";
import { applicationCompany, ApplyError, replan, runApplication, saveAnswer } from "@/lib/apply/service";

export const maxDuration = 600;

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("answer"),
    answers: z.array(z.object({ question: z.string().min(1), answer: z.string().trim().min(1).max(5000) })).min(1),
  }),
  z.object({ action: z.literal("replan") }),
  z.object({ action: z.literal("run"), live: z.boolean() }),
]);

export async function POST(request: Request, ctx: RouteContext<"/api/applications/[id]">) {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });

  try {
    const body = parsed.data;
    if (body.action === "answer") {
      // Saved to the answer library, so the same question is answered automatically next time.
      const company = await applicationCompany(id);
      for (const a of body.answers) await saveAnswer(a.question, a.answer, company);
      await replan(id);
    } else if (body.action === "replan") {
      await replan(id);
    } else {
      const result = await runApplication(id, body.live);
      return Response.json({ outcome: result.outcome, error: result.error ?? null });
    }
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof ApplyError) return Response.json({ error: err.message }, { status: 422 });
    console.error(err);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
