// Dev helper: plan + DRY-RUN one Workable job with a fake profile. No database, never submits.
// Usage: npx tsx --env-file=.env.local --conditions=react-server scripts/workable-dry-run.mts <workable-job-url>
// Uses a clearly fake sample profile and a generated sample resume in /tmp; the filler blocks
// every non-GET request and never clicks Submit.
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { fillWorkable } from "@/lib/apply/workable-fill";
import { planApplication } from "@/lib/apply/plan";
import { fetchWorkableJob, parseWorkableUrl, workableFields } from "@/lib/ats/workable";
import { emptyProfile, type Profile } from "@/lib/profile-schema";

const url = process.argv[2];
const ref = url ? parseWorkableUrl(url) : null;
if (!ref) throw new Error("Pass a Workable job URL (apply.workable.com/{account}/j/{shortcode})");

// Sample resume: a tiny HTML page printed to PDF (never the user's real resume under .data/files).
const resume = "/tmp/priya-raman-resume.pdf";
if (!existsSync(resume)) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(
    "<h1>Priya Raman</h1><p>priya.raman@example.com · Dubai, United Arab Emirates</p>" +
      "<h2>Experience</h2><p>Senior Software Engineer, Example Corp (2020–present)</p><p><i>Sample resume for testing only.</i></p>",
  );
  await page.pdf({ path: resume, format: "A4" });
  await browser.close();
}

// Clearly fake sample candidate.
const profile: Profile = {
  ...emptyProfile(),
  firstName: "Priya",
  lastName: "Raman",
  email: "priya.raman@example.com",
  phone: "4155550142",
  location: "Dubai, United Arab Emirates",
  country: "United Arab Emirates",
  workAuthorizations: [{ country: "United Arab Emirates", authorized: true, needsSponsorship: false }],
  resumeFile: { path: resume, filename: "priya-raman-resume.pdf" },
};

const t0 = Date.now();
const job = await fetchWorkableJob(ref);
const fields = workableFields(job);
console.log(`${job.company} — ${job.title} (${job.location}); ${fields.length} fields in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const f of fields) {
  const opts = f.options.length ? ` [${f.options.length} options]` : "";
  console.log(`  ${f.group.padEnd(8)} ${f.kind.padEnd(11)} ${f.required ? "*" : " "} ${f.id.slice(0, 16).padEnd(16)} ${f.label.slice(0, 70).replace(/\n/g, " ")}${opts}`);
}

const { needsAi, ...plan } = planApplication(fields, profile, new Map(), { company: job.company, jobLocation: job.location });
console.log("\nPlan:");
for (const a of plan.answers) console.log(`  [${a.source}] ${a.label.slice(0, 60)} = ${String(Array.isArray(a.value) ? a.value.join(", ") : a.value).slice(0, 80)}`);
for (const m of plan.missing) console.log(`  [MISSING] ${m.label.slice(0, 80).replace(/\n/g, " ")} — ${m.reason}`);
for (const f of needsAi) console.log(`  [NEEDS AI] ${f.label.slice(0, 80).replace(/\n/g, " ")}`);
console.log(`  skipped optional: ${plan.skipped.map((s) => s.label.slice(0, 40)).join(" | ") || "none"}`);

const t1 = Date.now();
const r = await fillWorkable({
  applicationId: `workable-dry-run-${ref.account}-${ref.shortcode}`,
  applyUrl: job.applyUrl,
  answers: plan.answers,
  profile,
  live: false, // never submit from this script
});
console.log(`\nDry run: ${r.outcome} in ${((Date.now() - t1) / 1000).toFixed(1)}s ${r.error ?? ""}`);
r.log.forEach((l) => console.log("  " + l));
console.log("Screenshot:", r.screenshotPath);
process.exit(0);
