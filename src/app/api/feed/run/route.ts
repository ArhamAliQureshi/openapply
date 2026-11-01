import { runFeed } from "@/lib/feed/run";

export const maxDuration = 600;

export async function POST() {
  try {
    return Response.json(await runFeed());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Feed failed." }, { status: 422 });
  }
}
