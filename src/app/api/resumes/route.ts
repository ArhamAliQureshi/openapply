import Anthropic from "@anthropic-ai/sdk";
import { getDb, schema } from "@/db";
import { emptyResume } from "@/lib/resume-schema";
import { AiProviderUnavailableError, parseResumeFile, ResumeParseError } from "@/lib/parse-resume";

export const maxDuration = 600;

// POST multipart/form-data with `file` → parse with the configured AI provider and create a resume.
// POST multipart/form-data without a file → create a blank resume.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Expected multipart form data." }, { status: 400 });

  const file = form.get("file");
  const db = await getDb();

  if (!(file instanceof File)) {
    const [row] = await db
      .insert(schema.resumes)
      .values({ title: "Untitled resume", data: emptyResume() })
      .returning({ id: schema.resumes.id });
    return Response.json({ id: row.id }, { status: 201 });
  }

  try {
    const { resume, sourceText } = await parseResumeFile(file);
    const title = resume.basics.name ? `${resume.basics.name} — Resume` : file.name;
    const [row] = await db
      .insert(schema.resumes)
      .values({ title, data: resume, sourceFilename: file.name, sourceText })
      .returning({ id: schema.resumes.id });
    return Response.json({ id: row.id }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof ResumeParseError) {
    return Response.json({ error: err.message }, { status: 422 });
  }
  if (err instanceof AiProviderUnavailableError) {
    return Response.json({ error: err.message }, { status: 503 });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return Response.json(
      { error: "Claude API key missing or invalid. Set ANTHROPIC_API_KEY in .env.local and restart." },
      { status: 500 },
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return Response.json({ error: "Rate limited by the Claude API. Try again shortly." }, { status: 429 });
  }
  if (err instanceof Anthropic.APIError) {
    console.error("Claude API error", err.status, err.message);
    return Response.json({ error: "The parsing service failed. Try again." }, { status: 502 });
  }
  if (err instanceof Error && /api key|apiKey|authentication/i.test(err.message)) {
    return Response.json(
      { error: "Claude API key missing. Set ANTHROPIC_API_KEY in .env.local and restart." },
      { status: 500 },
    );
  }
  console.error(err);
  return Response.json({ error: "Unexpected error while parsing." }, { status: 500 });
}
