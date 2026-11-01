import { runAutopilotIfDue } from "@/lib/apply/autopilot";

export const maxDuration = 3600;

// Internal: called hourly by src/instrumentation.ts with a per-boot token.
export async function POST(request: Request) {
  const token = (globalThis as { __autopilotToken?: string }).__autopilotToken;
  if (!token || request.headers.get("x-autopilot-token") !== token) return new Response(null, { status: 403 });
  // Don't hold the scheduler's request open for the whole run.
  void runAutopilotIfDue().catch((err) => console.error("[autopilot]", err));
  return Response.json({ ok: true });
}
