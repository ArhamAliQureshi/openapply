import { autopilotRunning, runAutopilot } from "@/lib/apply/autopilot";

export const maxDuration = 3600;

// "Run now" button: starts a run in the background and returns immediately.
export async function POST(request: Request) {
  if (autopilotRunning()) return Response.json({ started: false, message: "Already running." });
  const { refreshFeed = true } = (await request.json().catch(() => ({}))) as { refreshFeed?: boolean };
  void runAutopilot({ refreshFeed }).catch((err) => console.error("[autopilot]", err));
  return Response.json({ started: true });
}

export async function GET() {
  return Response.json({ running: autopilotRunning() });
}
