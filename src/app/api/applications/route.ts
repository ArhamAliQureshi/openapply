import { z } from "zod";
import { ApplyError, planFromUrl } from "@/lib/apply/service";
import { GreenhouseError } from "@/lib/ats/greenhouse";

export const maxDuration = 600;

const Body = z.object({ url: z.url() });

// Reads a job link and plans the application (no browser yet).
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Paste a job link." }, { status: 400 });
  try {
    return Response.json({ id: await planFromUrl(parsed.data.url) }, { status: 201 });
  } catch (err) {
    if (err instanceof ApplyError || err instanceof GreenhouseError) {
      return Response.json({ error: err.message }, { status: 422 });
    }
    console.error(err);
    return Response.json({ error: "Couldn't plan this application." }, { status: 500 });
  }
}
