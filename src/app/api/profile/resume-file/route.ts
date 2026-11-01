import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getProfile, saveProfile } from "@/lib/apply/service";
import { MAX_UPLOAD_BYTES, parseResumeFile } from "@/lib/parse-resume";
import type { Profile } from "@/lib/profile-schema";

export const maxDuration = 600;

const FILES_DIR = path.join(process.cwd(), ".data", "files");

// Stores the resume that gets attached to applications, and pre-fills empty profile fields from it.
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a file." }, { status: 400 });
  const ext = path.extname(file.name).toLowerCase();
  if (![".pdf", ".docx"].includes(ext)) return Response.json({ error: "Upload a PDF or DOCX." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "Files must be 10 MB or smaller." }, { status: 400 });

  await mkdir(FILES_DIR, { recursive: true });
  const filePath = path.join(FILES_DIR, `resume-${Date.now()}${ext}`);
  await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

  let profile: Profile = { ...(await getProfile()), resumeFile: { path: filePath, filename: file.name } };
  let prefilled: string[] = [];
  let prefillError: string | null = null;
  if (form?.get("prefill") !== "false") {
    try {
      ({ profile, prefilled } = prefill(profile, (await parseResumeFile(file)).resume));
    } catch (err) {
      console.error("Profile prefill failed", err);
      prefillError = err instanceof Error ? err.message : "Couldn't read the resume.";
    }
  }
  await saveProfile(profile);
  return Response.json({ ok: true, prefilled, prefillError });
}

type Parsed = Awaited<ReturnType<typeof parseResumeFile>>["resume"];

/** Copies facts from the parsed resume into profile fields that are still empty. */
function prefill(profile: Profile, r: Parsed) {
  const [first, ...rest] = r.basics.name.trim().split(/\s+/);
  const current = r.work.find((w) => /present|current/i.test(w.endDate)) ?? r.work[0];
  const linkedin = r.basics.profiles.find((p) => /linkedin/i.test(p.url))?.url ?? "";
  const github = r.basics.profiles.find((p) => /github/i.test(p.url))?.url ?? "";
  const candidates: Partial<Record<keyof Profile, string>> = {
    firstName: first ?? "",
    lastName: rest.join(" "),
    email: r.basics.email,
    phone: r.basics.phone,
    location: r.basics.location,
    linkedin,
    github,
    website: r.basics.url && !/linkedin|github/i.test(r.basics.url) ? r.basics.url : "",
    currentTitle: current?.position ?? "",
    currentCompany: current?.company ?? "",
    aboutMe: r.basics.summary,
  };
  const next = { ...profile } as Record<string, unknown>;
  const prefilled: string[] = [];
  const employers = [...new Set(r.work.map((w) => w.company.trim()).filter(Boolean))];
  if (!profile.pastEmployers.length && employers.length) {
    next.pastEmployers = employers;
    prefilled.push("pastEmployers");
  }
  for (const [key, value] of Object.entries(candidates)) {
    if (value && !String(next[key] ?? "").trim()) {
      next[key] = value;
      prefilled.push(key);
    }
  }
  return { profile: next as Profile, prefilled };
}
