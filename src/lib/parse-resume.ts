import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import { AiProviderUnavailableError, getAiSettings, type AiProvider, type ModelChoice } from "./ai/config";
import { ollamaChat } from "./ai/ollama";
import { isUnsupportedParams, openrouterChat } from "./ai/openrouter";
import { track } from "./activity";
import { cleanResume } from "./clean-resume";
import { ResumeSchema, type Resume } from "./resume-schema";

// The provider and model for resume reading are chosen on the Settings page (see ai/config.ts).
export { AiProviderUnavailableError };

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const INSTRUCTIONS = `Extract this resume into the provided schema.

Rules:
- Copy the candidate's wording; do not invent, embellish or summarise facts that are not in the document.
- Use an empty string or empty array for anything the resume does not contain.
- Dates: copy only what is written. "YYYY-MM" only when the month is written in the resume; if only a year is written, use "YYYY". Never add a month that is not written. Use "Present" for current roles.
- Put each bullet point in its own highlights entry, without the bullet character.
- A role's "summary" is only for a separate description line that is not a bullet. Never repeat the highlights in the summary; leave it empty instead.
- A project's "highlights" must not repeat its description.
- Education: the school goes in "institution", the degree only (e.g. "M.S.", "B.E.") in "studyType", the subject in "area", and the years in "startDate"/"endDate". Never put dates or grades inside the degree or subject. List each degree once.
- profiles: only real links written in the resume (e.g. linkedin.com/in/..., github.com/...). Never put dates or other text there.
- Group skills sensibly (e.g. Languages, Frameworks, Cloud, Tools) if the resume lists them flat.
- Order work and education most recent first.`;

export class ResumeParseError extends Error {}

export type ParsedUpload = { resume: Resume; sourceText: string | null };

type Source = { kind: "pdf"; bytes: Buffer; text: string } | { kind: "text"; text: string };

async function readSource(file: File, provider: AiProvider): Promise<Source> {
  if (file.size === 0) throw new ResumeParseError("The file is empty.");
  if (file.size > MAX_UPLOAD_BYTES) throw new ResumeParseError("Files must be 10 MB or smaller.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  let source: Source;

  if (file.type === PDF || name.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes)).catch(() => {
      throw new ResumeParseError("That PDF couldn't be opened.");
    });
    const { text } = await extractText(pdf, { mergePages: true });
    source = { kind: "pdf", bytes, text: text.trim() };
  } else if (file.type === DOCX || name.endsWith(".docx")) {
    source = { kind: "text", text: (await mammoth.extractRawText({ buffer: bytes })).value.trim() };
  } else if (file.type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    source = { kind: "text", text: bytes.toString("utf8").trim() };
  } else {
    throw new ResumeParseError("Upload a PDF, DOCX or TXT file.");
  }

  // Claude can read scanned PDFs (it sees the pages), so only require text when it is the only input.
  const needsText = source.kind === "text" || provider !== "claude";
  if (needsText && source.text.length < 30) {
    throw new ResumeParseError(
      source.kind === "pdf"
        ? "No selectable text found in this PDF (it may be a scan)."
        : "Couldn't find any text in that file.",
    );
  }
  return source;
}

export function parseResumeFile(file: File): Promise<ParsedUpload> {
  return track("resume", `Reading resume: ${file.name}`, async (ctx) => {
    const choice = (await getAiSettings()).parse;
    ctx.step("Extracting text from the file");
    const source = await readSource(file, choice.provider);
    ctx.step(`Sending to ${choice.provider} · ${choice.model}`);
    const resume = cleanResume(await parseSource(source, choice), source.text);
    ctx.result(`${resume.work.length} jobs, ${resume.education.length} degrees, ${resume.skills.length} skill groups`);
    return { resume, sourceText: source.text || null };
  });
}

/** Parses resume text with a specific provider/model (used by the Settings page's Test button). */
export async function parseResumeText(text: string, choice: ModelChoice): Promise<Resume> {
  return cleanResume(await parseSource({ kind: "text", text }, choice), text);
}

function parseSource(source: Source, { provider, model, fallbacks }: ModelChoice): Promise<Resume> {
  if (provider === "claude") return parseWithClaude(source, model);
  if (provider === "openrouter") return parseWithOpenRouter(source.text, model, fallbacks);
  return parseWithOllama(source.text, model);
}

/** Parses a model's JSON reply and checks it against the resume schema. */
function validate(content: string, who: string): Resume {
  let json: unknown;
  try {
    // Some models wrap JSON in a markdown fence even when a format is requested.
    json = JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ResumeParseError(`${who} returned invalid JSON. Try again or pick another model in Settings.`);
  }
  const parsed = ResumeSchema.safeParse(json);
  if (!parsed.success) {
    console.error(`${who} output failed schema validation`, parsed.error.issues.slice(0, 5));
    throw new ResumeParseError(`${who}'s output didn't match the resume format. Try again or pick another model in Settings.`);
  }
  return parsed.data;
}

// --- Claude ---------------------------------------------------------------

let client: Anthropic | undefined;
function getClient() {
  // Reads ANTHROPIC_API_KEY (or another configured credential) from the environment.
  client ??= new Anthropic();
  return client;
}

async function parseWithClaude(source: Source, model: string): Promise<Resume> {
  // Claude reads PDFs natively (text + layout), so send the file itself rather than extracted text.
  const block: BetaContentBlockParam =
    source.kind === "pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: source.bytes.toString("base64") },
        }
      : { type: "text", text: `<resume>\n${source.text}\n</resume>` };

  const response = await getClient().beta.messages.parse({
    model,
    max_tokens: 16000,
    // Server-side fallback: if a safety classifier declines, the API retries on a fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { format: betaZodOutputFormat(ResumeSchema) },
    messages: [{ role: "user", content: [block, { type: "text", text: INSTRUCTIONS }] }],
  });

  if (response.stop_reason === "refusal") {
    throw new ResumeParseError("The model declined to process this document.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new ResumeParseError("The resume was too long to parse in one pass.");
  }
  if (!response.parsed_output) {
    throw new ResumeParseError("Couldn't read a resume from that file.");
  }
  return response.parsed_output;
}

// --- OpenRouter and Ollama (text in, JSON out) ------------------------------

// Caps on array lengths. Small models can loop, repeating the same jobs until the token limit
// cuts the JSON off; capped arrays end the loop and the clean-up step removes the repeats.
const ARRAY_CAPS: Record<string, number> = {
  work: 15,
  education: 8,
  skills: 15,
  projects: 10,
  certifications: 15,
  languages: 10,
  profiles: 8,
  highlights: 12,
  keywords: 40,
};

function capArrays(node: unknown, key = ""): unknown {
  if (Array.isArray(node)) return node.map((n) => capArrays(n));
  if (!node || typeof node !== "object") return node;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    // Inside "properties", each child key is a field name (e.g. "work"); elsewhere keep the parent's.
    o[k] = k === "properties" && v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).map(([name, child]) => [name, capArrays(child, name)]))
      : capArrays(v, k === "items" ? "" : key);
  }
  if (o.type === "array" && ARRAY_CAPS[key]) o.maxItems = ARRAY_CAPS[key];
  return o;
}

const resumeJsonSchema = capArrays(z.toJSONSchema(ResumeSchema));

// Asking for minified JSON stops small models from padding the output with endless whitespace.
const JSON_SYSTEM = `${INSTRUCTIONS}\n\nRespond with minified JSON on a single line, with no extra whitespace or newlines.`;

async function parseWithOpenRouter(text: string, model: string, fallbacks: string[]): Promise<Resume> {
  const messages = (system: string) => [
    { role: "system" as const, content: system },
    { role: "user" as const, content: `<resume>\n${text}\n</resume>` },
  ];
  try {
    const content = await openrouterChat({
      model,
      fallbacks,
      maxTokens: 12000,
      schema: { name: "resume", schema: resumeJsonSchema },
      messages: messages(JSON_SYSTEM),
    });
    return validate(content, `OpenRouter model "${model}"`);
  } catch (err) {
    if (!isUnsupportedParams(err)) throw err;
    // No host for this model enforces a schema (e.g. free Gemma 4): ask for plain JSON mode and
    // describe the schema in the prompt. validate() and the clean-up step catch mistakes.
    const content = await openrouterChat({
      model,
      fallbacks,
      maxTokens: 12000,
      jsonMode: true,
      messages: messages(`${JSON_SYSTEM}\n\nThe JSON must match this JSON Schema exactly:\n${JSON.stringify(resumeJsonSchema)}`),
    });
    return validate(content, `OpenRouter model "${model}"`);
  }
}

async function parseWithOllama(text: string, model: string): Promise<Resume> {
  const ask = () =>
    ollamaChat({
      model,
      format: resumeJsonSchema, // Ollama constrains decoding to this schema
      options: { temperature: 0, num_ctx: 8192, num_predict: 6000 },
      messages: [
        { role: "system", content: JSON_SYSTEM },
        { role: "user", content: `<resume>\n${text}\n</resume>` },
      ],
    });
  // Small models sometimes get stuck emitting whitespace; ollamaChat aborts that, so retry once.
  const content = (await ask()) ?? (await ask());
  if (!content) throw new ResumeParseError("The local model got stuck. Try again or pick another model in Settings.");
  return validate(content, `Local model "${model}"`);
}
