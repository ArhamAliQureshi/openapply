import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";

// Which AI runs each task. Stored in the database (app_state "ai") and edited on the Settings page.
// API keys stay in .env.local; this only picks providers and models.

export const PROVIDERS = ["openrouter", "ollama", "claude"] as const;
export type AiProvider = (typeof PROVIDERS)[number];

const ModelChoiceSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1),
  // OpenRouter only: tried in order when the main model is rate-limited or down.
  fallbacks: z.array(z.string().trim().min(1)).max(4).default([]),
});
export const AiSettingsSchema = z.object({
  parse: ModelChoiceSchema, // resume reading (needs structured JSON output)
  write: ModelChoiceSchema, // written answers ("Why do you want to work here?")
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;
export type ModelChoice = z.infer<typeof ModelChoiceSchema>;

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  openrouter: process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3.5-super-vl:free",
  ollama: process.env.OLLAMA_MODEL ?? "gemma4:e2b",
  claude: "claude-opus-5-5",
};

// Free models that handled structured resume output in testing; used as OpenRouter fallbacks by default.
export const DEFAULT_OPENROUTER_FALLBACKS = ["xingchen-agi/xing4.0-29b-a4b:free", "dots-studio/dots-3-note-preview:free"];

export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

function envDefault(): AiSettings {
  const p = process.env.AI_PROVIDER;
  const provider: AiProvider = p === "ollama" || p === "openrouter" || p === "claude" ? p : "claude";
  const choice = {
    provider,
    model: DEFAULT_MODELS[provider],
    fallbacks: provider === "openrouter" ? DEFAULT_OPENROUTER_FALLBACKS : [],
  };
  return { parse: choice, write: choice };
}

const KEY = "ai";

export async function getAiSettings(): Promise<AiSettings> {
  const db = await getDb();
  const [row] = await db.select({ value: schema.appState.value }).from(schema.appState).where(eq(schema.appState.key, KEY));
  const parsed = AiSettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : envDefault();
}

export async function saveAiSettings(settings: AiSettings) {
  const db = await getDb();
  await db
    .insert(schema.appState)
    .values({ key: KEY, value: settings })
    .onConflictDoUpdate({ target: schema.appState.key, set: { value: settings, updatedAt: new Date() } });
}

export class AiProviderUnavailableError extends Error {}

/** Whether each provider can be used right now (key present / local server reachable). */
export async function providerStatus(): Promise<Record<AiProvider, { ready: boolean; note: string }>> {
  const ollamaUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const ollamaUp = await fetch(`${ollamaUrl}/api/version`, { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
  return {
    openrouter: process.env.OPENROUTER_API_KEY
      ? { ready: true, note: "API key set" }
      : { ready: false, note: "Add OPENROUTER_API_KEY to .env.local" },
    ollama: ollamaUp ? { ready: true, note: `Running at ${ollamaUrl}` } : { ready: false, note: "Ollama app is not running" },
    claude: process.env.ANTHROPIC_API_KEY
      ? { ready: true, note: "API key set" }
      : { ready: false, note: "Add ANTHROPIC_API_KEY to .env.local" },
  };
}
