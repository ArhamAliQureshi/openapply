import { z } from "zod";
import { getProfile, saveProfile } from "@/lib/apply/service";
import { AutopilotSchema, FeedPreferencesSchema } from "@/lib/profile-schema";

const Body = z.object({ feed: FeedPreferencesSchema.optional(), autopilot: AutopilotSchema.optional() });

// Updates only the job-search preferences and autopilot settings.
export async function PATCH(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid settings." }, { status: 400 });
  const profile = await getProfile();
  await saveProfile({ ...profile, ...parsed.data });
  return Response.json({ ok: true });
}
