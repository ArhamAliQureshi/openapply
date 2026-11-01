import { AiSettingsSchema, CLAUDE_MODELS, getAiSettings, providerStatus, saveAiSettings } from "@/lib/ai/config";
import { listOllamaModels } from "@/lib/ai/ollama";

export async function GET() {
  const [settings, status, ollamaModels] = await Promise.all([getAiSettings(), providerStatus(), listOllamaModels()]);
  return Response.json({ settings, status, claudeModels: CLAUDE_MODELS, ollamaModels });
}

export async function PUT(request: Request) {
  const parsed = AiSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid AI settings." }, { status: 400 });
  await saveAiSettings(parsed.data);
  return Response.json({ ok: true });
}
