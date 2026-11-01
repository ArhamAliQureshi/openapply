import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAiSettings } from "./ai/config";
import { ollamaChat } from "./ai/ollama";
import { openrouterChat } from "./ai/openrouter";

// Short free-text generation (e.g. "Why do you want to work here?") with the provider and model
// chosen for written answers on the Settings page.

let client: Anthropic | undefined;

export async function generateText(
  system: string,
  prompt: string,
  choice?: { provider: string; model: string; fallbacks?: string[] },
  onToken?: (text: string) => void, // stream the answer token by token
): Promise<string> {
  const { provider, model, fallbacks = [] } = choice ?? (await getAiSettings()).write;

  if (provider === "openrouter") {
    return openrouterChat({
      model,
      fallbacks,
      onToken,
      maxTokens: 1500,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });
  }

  if (provider === "ollama") {
    const text = await ollamaChat({
      model,
      onToken,
      options: { temperature: 0.4, num_ctx: 8192, num_predict: 800 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    });
    return (text ?? "").trim();
  }

  client ??= new Anthropic();
  const stream = client.beta.messages.stream({
    model,
    max_tokens: 2000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (onToken) stream.on("text", (delta) => onToken(delta));
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") throw new Error("The model declined to write this answer.");
  return response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();
}
