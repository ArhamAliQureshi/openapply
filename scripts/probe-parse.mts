// Dev helper: run the local-model resume extraction on a file and report why JSON parsing fails (no content printed).
import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import { ResumeSchema } from "@/lib/resume-schema";

// Caps array lengths so a repetition loop can't run until the token limit.
const CAPS: Record<string, number> = { work: 15, education: 8, skills: 15, projects: 10, certifications: 15, languages: 10, profiles: 8, highlights: 12, keywords: 40 };
function limited(schema: unknown): unknown {
  const walk = (node: unknown, key?: string): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n));
    if (!node || typeof node !== "object") return node;
    const o = Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)])) as Record<string, unknown>;
    if (o.type === "array" && key && CAPS[key] && process.env.CAPS !== "0") o.maxItems = CAPS[key];
    return o;
  };
  const s = walk(schema) as { properties?: Record<string, unknown> };
  // properties' keys are the parent keys of each array schema
  for (const [k, v] of Object.entries(s.properties ?? {})) if (v && typeof v === "object") (s.properties as Record<string, unknown>)[k] = walkProps(k, v);
  return s;
  function walkProps(k: string, v: unknown): unknown {
    const o = v as Record<string, unknown>;
    if (o.type === "array" && CAPS[k] && process.env.CAPS !== "0") o.maxItems = CAPS[k];
    if (o.properties) for (const [kk, vv] of Object.entries(o.properties as Record<string, unknown>)) (o.properties as Record<string, unknown>)[kk] = walkProps(kk, vv);
    if (o.items) o.items = walkProps("", o.items);
    return o;
  }
}
const pdf = await getDocumentProxy(new Uint8Array(readFileSync(process.argv[2])));
const { text } = await extractText(pdf, { mergePages: true });
const src = readFileSync("src/lib/parse-resume.ts", "utf8");
const i = src.indexOf("const INSTRUCTIONS = `") + 22;
const INSTRUCTIONS = src.slice(i, src.indexOf("`;", i));
console.log(`resume text: ${text.length} chars, ~${Math.round(text.length / 4)} tokens`);
const t0 = Date.now();
const res = await fetch("http://localhost:11434/api/chat", {
  method: "POST",
  body: JSON.stringify({
    model: "gemma4:e2b", stream: false, think: false, format: limited(z.toJSONSchema(ResumeSchema)),
    options: { temperature: 0, num_ctx: 8192, num_predict: 6000, repeat_penalty: Number(process.env.RP ?? 1), repeat_last_n: 512 },
    messages: [
      { role: "system", content: `${INSTRUCTIONS}\n\nRespond with minified JSON on a single line, with no extra whitespace or newlines.` },
      { role: "user", content: `<resume>\n${text}\n</resume>` },
    ],
  }),
});
const d = await res.json();
const out: string = d.message?.content ?? "";
console.log(`secs ${((Date.now() - t0) / 1000).toFixed(0)}, prompt_tokens ${d.prompt_eval_count}, output_tokens ${d.eval_count}, done_reason ${d.done_reason}, chars ${out.length}`);
const pieces = out.split(/","|\["|"\]/).map((x) => x.trim()).filter((x) => x.length > 25);
const seen = new Map<string, number>();
for (const x of pieces) seen.set(x, (seen.get(x) ?? 0) + 1);
const dup = [...seen.values()].filter((n) => n > 1);
console.log(`strings: ${pieces.length}, distinct: ${seen.size}, repeated strings: ${dup.length}, max repeats of one string: ${Math.max(0, ...dup)}`);
const keys = (out.match(/"(company|institution|name|language)":/g) ?? []).reduce((m: Record<string, number>, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
console.log("section item counts:", JSON.stringify(keys));
try { JSON.parse(out); console.log("JSON OK"); } catch (e) { console.log("JSON FAIL:", (e as Error).message.slice(0, 120)); console.log("last 60 chars shape:", JSON.stringify(out.slice(-60).replace(/[A-Za-z0-9]/g, "x"))); }
process.exit(0);
