// Dev helper: plan + DRY-RUN one Ashby job with a fake profile. No database, never submits.
// Usage: npx tsx --env-file=.env.local --conditions=react-server scripts/ashby-dry-run.mts <ashby-job-url>
import path from "node:path";
import { fillAshby } from "@/lib/apply/ashby-fill";
import { planApplication } from "@/lib/apply/plan";
import { ASHBY_STANDARD_VALUES, ashbyFields, fetchAshbyJob, parseAshbyUrl } from "@/lib/ats/ashby";
import { emptyProfile, type Profile } from "@/lib/profile-schema";

const url = process.argv[2];
const ref = url ? parseAshbyUrl(url) : null;
if (!ref) throw new Error("Pass an Ashby job URL (jobs.ashbyhq.com/{org}/{job-id})");

// Clearly fake sample candidate.
const profile: Profile = {
  ...emptyProfile(),
  firstName: "Priya",
  lastName: "Raman",
  email: "priya.raman@example.com",
  phone: "4155550142",
  phoneCountry: "United States",
  location: "San Francisco, CA",
  country: "United States",
  linkedin: "https://www.linkedin.com/in/example-candidate-example",
  github: "https://github.com/example-candidate-example",
  currentTitle: "Senior Software Engineer",
  currentCompany: "Example Corp",
  noticePeriod: "2 weeks",
  workAuthorizations: [{ country: "United States", authorized: true, needsSponsorship: false }],
  resumeFile: {
    path: path.join(process.cwd(), ".data", "files", "sample-resume.pdf"),
    filename: "sample-resume.pdf",
  },
};

const t0 = Date.now();
const job = await fetchAshbyJob(ref.org, ref.jobId);
const fields = ashbyFields(job);
const { needsAi, ...plan } = planApplication(fields, profile, new Map(), { company: job.company, jobLocation: job.location });
// Stand-in for the pending plan.ts change (STANDARD_VALUES += ASHBY_STANDARD_VALUES): fill Ashby's full-name field.
for (const m of [...plan.missing]) {
  const value = ASHBY_STANDARD_VALUES[m.fieldId]?.(profile);
  if (!value) continue;
  plan.missing.splice(plan.missing.indexOf(m), 1);
  plan.answers.unshift({ fieldId: m.fieldId, label: m.label, kind: m.kind, value, source: "profile" });
}
console.log(`${job.company} — ${job.title} (${job.location}); ${fields.length} fields, planned in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const f of fields) console.log(`  field ${f.group.padEnd(8)} ${f.kind.padEnd(11)} ${f.required ? "*" : " "} ${f.id.slice(0, 40).padEnd(40)} ${f.label.slice(0, 70)}`);
for (const a of plan.answers) console.log(`  [${a.source}] ${a.label.slice(0, 70)} = ${String(Array.isArray(a.value) ? a.value.join(", ") : a.value).slice(0, 80)}`);
for (const m of plan.missing) console.log(`  [MISSING] ${m.label.slice(0, 70)} — ${m.reason}`);
for (const f of needsAi) console.log(`  [AI] ${f.label.slice(0, 70)} (not written in this script)`);
console.log(`  skipped optional: ${plan.skipped.map((s) => s.label.slice(0, 40)).join(", ") || "none"}`);

const t1 = Date.now();
const r = await fillAshby({
  applicationId: `ashby-dry-run-${ref.org}-${ref.jobId.slice(0, 8)}`,
  applyUrl: job.applyUrl,
  answers: plan.answers,
  profile,
  live: false, // never submit from this script
});
console.log(`Dry run: ${r.outcome} in ${((Date.now() - t1) / 1000).toFixed(1)}s ${r.error ?? ""}`);
r.log.forEach((l) => console.log("  " + l));
console.log("Screenshot:", r.screenshotPath);
process.exit(0);
