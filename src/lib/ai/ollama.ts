import "server-only";
import { AiProviderUnavailableError } from "./config";

// Local models through Ollama (free, offline, slower).

export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
// Local models are slow on modest hardware; allow 10 minutes by default.
export const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 600_000;

type Message = { role: "system" | "user" | "assistant"; content: string };

/**
 * Streams a chat reply. With stream: false Ollama sends nothing until it finishes, and Node's
 * fetch gives up after 5 minutes without response headers. Returns null if the model starts
 * looping on whitespace (a failure mode of small models with JSON output).
 */
export async function ollamaChat(opts: {
  model: string;
  messages: Message[];
  format?: unknown;
  options?: Record<string, unknown>;
  onToken?: (text: string) => void;
}): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model, stream: true, think: false, format: opts.format, options: opts.options, messages: opts.messages }),
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
  } catch (err) {
    throw unavailable(err, opts.model);
  }
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new AiProviderUnavailableError(
      `Ollama returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}. Is the model "${opts.model}" pulled?`,
    );
  }

  // Newline-delimited JSON chunks: {"message":{"content":"..."},"done":false}
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  let content = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { message?: { content?: string }; error?: string };
        if (event.error) throw new AiProviderUnavailableError(`Ollama error: ${event.error}`);
        const chunk = event.message?.content ?? "";
        content += chunk;
        if (chunk) opts.onToken?.(chunk);
      }
      if (/\s{80}$/.test(content)) {
        await reader.cancel();
        return null;
      }
    }
  } catch (err) {
    if (err instanceof AiProviderUnavailableError) throw err;
    throw unavailable(err, opts.model);
  }
  return content;
}

function unavailable(err: unknown, model: string) {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return new AiProviderUnavailableError(
      `The local model "${model}" took over ${Math.round(OLLAMA_TIMEOUT_MS / 60_000)} minutes. Pick a faster model on the Settings page.`,
    );
  }
  return new AiProviderUnavailableError(`Couldn't reach Ollama at ${OLLAMA_BASE_URL}. Start the Ollama app or pick another provider.`);
}

export async function listOllamaModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!res?.ok) return [];
  const { models } = (await res.json()) as { models: { name: string }[] };
  return models.map((m) => m.name);
}
