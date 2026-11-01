import { listActivities } from "@/lib/activity";

// Live list of background work for the Agents page.
export function GET() {
  return Response.json({ now: Date.now(), activities: listActivities() }, { headers: { "cache-control": "no-store" } });
}
