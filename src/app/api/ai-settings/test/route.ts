import { z } from "zod";
import { generateText } from "@/lib/ai-text";
import { PROVIDERS } from "@/lib/ai/config";
import { parseResumeText } from "@/lib/parse-resume";

export const maxDuration = 600;

const Body = z.object({
  task: z.enum(["parse", "write"]),
  choice: z.object({
    provider: z.enum(PROVIDERS),
    model: z.string().min(1),
    fallbacks: z.array(z.string()).default([]),
  }),
});

// Marks an error line at the end of a streamed test answer.
const STREAM_ERROR = "[error] ";

const SAMPLE = `Jane Doe — Backend Engineer — jane@example.com — Dubai, UAE
EXPERIENCE
Acme Corp, Senior Engineer, 2021-03 – Present
- Built payment APIs handling 2M requests/day
Globex, Engineer, 2018-07 – 2021-02
- Migrated services to Kubernetes
EDUCATION
NUST, BS Computer Science, 2014 – 2018
SKILLS: Go, PostgreSQL, Kafka, AWS`;

// Runs a tiny real request with the chosen model so the user can check it before saving.
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { task, choice } = parsed.data;
  const started = Date.now();
  try {
    if (task === "parse") {
      const r = await parseResumeText(SAMPLE, choice);
      const ok = r.basics.name.includes("Jane") && r.work.length === 2 && r.education.length === 1;
      return Response.json({
        ok,
        seconds: (Date.now() - started) / 1000,
        result: `${r.basics.name || "no name"} · ${r.work.length} jobs (expected 2) · ${r.education.length} degree · ${r.skills.flatMap((s) => s.keywords).length} skills`,
      });
    }
    // Stream the answer as plain text so the page can show it token by token.
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          await generateText(
            "You write short, honest answers to job application questions. Two sentences, plain text.",
            "Candidate: backend engineer, 6 years, payments APIs in Go. Question: Why do you want to work at a fintech company?",
            choice,
            (token) => controller.enqueue(encoder.encode(token)),
          );
        } catch (err) {
          controller.enqueue(encoder.encode(`\n${STREAM_ERROR}${err instanceof Error ? err.message : String(err)}`));
        }
        controller.close();
      },
    });
    return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ ok: false, seconds: (Date.now() - started) / 1000, result: err instanceof Error ? err.message : String(err) });
  }
}
