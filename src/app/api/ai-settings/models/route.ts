import { listOpenRouterModels } from "@/lib/ai/openrouter";

// OpenRouter's public model catalog (cached for an hour on the server).
export async function GET() {
  try {
    return Response.json(await listOpenRouterModels());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't load models." }, { status: 502 });
  }
}
