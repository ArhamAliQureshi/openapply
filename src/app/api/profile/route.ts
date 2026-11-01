import { getProfile, saveProfile } from "@/lib/apply/service";
import { ProfileSchema } from "@/lib/profile-schema";

export async function GET() {
  return Response.json(await getProfile());
}

export async function PUT(request: Request) {
  const parsed = ProfileSchema.omit({ resumeFile: true, feed: true, autopilot: true }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return Response.json({ error: "Invalid profile." }, { status: 400 });
  // The resume file and job-search settings are changed through their own endpoints.
  const current = await getProfile();
  await saveProfile({ ...parsed.data, resumeFile: current.resumeFile, feed: current.feed, autopilot: current.autopilot });
  return Response.json({ ok: true });
}
