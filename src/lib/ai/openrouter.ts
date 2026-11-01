import "server-only";
import { AiProviderUnavailableError } from "./config";

// OpenRouter's chat completions API: one key, hundreds of models. https://openrouter.ai/docs

const URL_BASE = "https://openrouter.ai/api/v1";

type Message = { role: "system" | "user" | "assistant"; content: string };

export async function openrouterChat(opts: {
  model: string;
  fallbacks?: string[]; // tried by OpenRouter, in order, if the main model errors or is rate-limited
  messages: Message[];
  schema?: { name: string; schema: unknown }; // strict JSON output
  jsonMode?: boolean; // looser "valid JSON" mode for models without strict schema support
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  onToken?: (text: string) => void; // stream tokens as they arrive (plain text only, not with `schema`)
}): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new AiProviderUnavailableError("OpenRouter key missing. Add OPENROUTER_API_KEY to .env.local and restart.");

  let res: Response;
  try {
    res = await fetch(`${URL_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "ApplyKit",
      },
      body: JSON.stringify({
        model: opts.model,
        ...(opts.fallbacks?.length && { models: [opts.model, ...opts.fallbacks] }),
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 4000,
        ...(opts.onToken && { stream: true }),
        temperature: opts.temperature ?? 0,
        ...(opts.schema && {
          response_format: { type: "json_schema", json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema } },
          // Only route to hosts that actually enforce the schema.
          provider: { require_parameters: true },
        }),
        ...(!opts.schema && opts.jsonMode && { response_format: { type: "json_object" } }),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new AiProviderUnavailableError(`OpenRouter model "${opts.model}" timed out. Try another model on the Settings page.`);
    }
    throw new AiProviderUnavailableError("Couldn't reach OpenRouter. Check your internet connection.");
  }

  if (opts.onToken && res.ok && res.body) return readSse(res.body, opts.model, opts.onToken);

  const body = (await res.json().catch(() => ({}))) as {
    model?: string;
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    error?: { message?: string; code?: number };
  };
  if (!res.ok || body.error) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new AiProviderUnavailableError("OpenRouter rejected the API key. Check OPENROUTER_API_KEY.");
    if (res.status === 429) throw new AiProviderUnavailableError(`OpenRouter rate limit for "${opts.model}". Wait a bit or pick another model.`);
    throw new AiProviderUnavailableError(`OpenRouter error for "${opts.model}": ${msg.slice(0, 200)}`);
  }
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new AiProviderUnavailableError(`"${opts.model}" ran out of output tokens. Try a different model.`);
  }
  if (body.model && body.model !== opts.model) console.log(`[openrouter] ${opts.model} unavailable, answered by ${body.model}`);
  return (choice?.message?.content ?? "").trim();
}

/** Reads an OpenAI-style server-sent-events stream, forwarding each text delta. */
async function readSse(stream: ReadableStream<Uint8Array>, model: string, onToken: (t: string) => void): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue; // ": OPENROUTER PROCESSING" keep-alives etc.
      const data = line.slice(6).trim();
      if (data === "[DONE]") return text.trim();
      const event = JSON.parse(data) as {
        choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
        error?: { message?: string };
      };
      if (event.error) throw new AiProviderUnavailableError(`OpenRouter error for "${model}": ${event.error.message ?? "stream failed"}`);
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onToken(delta);
      }
    }
  }
  return text.trim();
}

/** True when OpenRouter has no host for this model that supports the requested parameters (e.g. strict JSON). */
export const isUnsupportedParams = (err: unknown) =>
  err instanceof AiProviderUnavailableError && /no endpoints found that can handle/i.test(err.message);

export type OpenRouterModel = {
  id: string;
  name: string;
  contextLength: number;
  free: boolean;
  structured: boolean;
  promptPrice: number; // USD per 1M tokens
  completionPrice: number;
};

let modelCache: { at: number; models: OpenRouterModel[] } | null = null;

/** Public model catalog (no key needed), cached for an hour. */
export async function listOpenRouterModels(): Promise<OpenRouterModel[]> {
  if (modelCache && Date.now() - modelCache.at < 3_600_000) return modelCache.models;
  const res = await fetch(`${URL_BASE}/models`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new AiProviderUnavailableError(`Couldn't load OpenRouter models (HTTP ${res.status}).`);
  const { data } = (await res.json()) as {
    data: { id: string; name: string; context_length: number; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[] }[];
  };
  const models = data
    .map((m) => {
      const prompt = Number(m.pricing?.prompt ?? 0) * 1e6;
      const completion = Number(m.pricing?.completion ?? 0) * 1e6;
      return {
        id: m.id,
        name: m.name,
        contextLength: m.context_length,
        free: prompt === 0 && completion === 0,
        structured: (m.supported_parameters ?? []).includes("structured_outputs"),
        promptPrice: prompt,
        completionPrice: completion,
      };
    })
    .sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));
  modelCache = { at: Date.now(), models };
  return models;
}
