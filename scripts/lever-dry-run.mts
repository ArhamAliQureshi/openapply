// Dev helper: plan + dry-run one Lever job without the web server or the database.
// Usage: npx tsx --env-file=.env.local --conditions=react-server scripts/lever-dry-run.mts <lever-job-url>
// Uses a clearly fake sample profile; the filler blocks every non-GET request and never submits.
import path from "node:path";
import { fetchLeverJob, leverApplyUrl, leverLocation, parseLeverUrl } from "@/lib/ats/lever";
import { fillLever } from "@/lib/apply/lever-fill";
import { planApplication } from "@/lib/apply/plan";
import { emptyProfile, type Profile } from "@/lib/profile-schema";

const url = process.argv[2];
if (!url) throw new Error("Pass a Lever job URL (jobs.lever.co/{company}/{id})");
const ref = parseLeverUrl(url);
if (!ref) throw new Error(`Not a Lever job URL: ${url}`);

const resume = path.join(process.cwd(), ".data", "files", "sample-resume.pdf");
const profile: Profile = {
  ...emptyProfile(),
  firstName: "Priya",
  lastName: "Raman",
  preferredName: "",
  email: "priya.raman@example.com",
  phone: "4155550142",
  phoneCountry: "United States",
  location: "San Francisco, CA",
  country: "United States",
  linkedin: "https://www.linkedin.com/in/example-candidate",
  github: "https://github.com/example-candidate",
  website: "",
  currentCompany: "Stripe",
  currentTitle: "Senior Software Engineer",
  workAuthorizations: [{ country: "United States", authorized: true, needsSponsorship: false }],
  willingToRelocate: false,
  over18: true,
  salaryExpectation: "",
  noticePeriod: "",
  howDidYouHear: "Company careers page",
  eeo: { gender: "", race: "", hispanic: "", veteran: "", disability: "" },
  aiWrittenAnswers: false,
  aboutMe: "",
  resumeFile: { path: resume, filename: "sample-resume.pdf" },
};

const t0 = Date.now();
const { posting, fields } = await fetchLeverJob(ref);
console.log(`${posting.text} @ ${ref.company} (${leverLocation(posting)}) — ${fields.length} fields in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const f of fields) {
  const opts = f.options.length ? ` [${f.options.length} options]` : "";
  console.log(`  ${f.group.padEnd(8)} ${f.kind.padEnd(11)} ${f.required ? "*" : " "} ${f.label.slice(0, 80).replace(/\n/g, " ")}${opts}`);
}

const { needsAi, ...plan } = planApplication(fields, profile, new Map(), {
  company: ref.company,
  jobLocation: leverLocation(posting),
});
console.log("\nPlan:");
for (const a of plan.answers) console.log(`  [${a.source}] ${a.label.slice(0, 60)} = ${String(Array.isArray(a.value) ? a.value.join(", ") : a.value).slice(0, 80)}`);
for (const m of plan.missing) console.log(`  [MISSING] ${m.label.slice(0, 80)} — ${m.reason}`);
for (const f of needsAi) console.log(`  [NEEDS AI] ${f.label.slice(0, 80)}`);
console.log(`  skipped optional: ${plan.skipped.map((s) => s.label.slice(0, 40)).join(" | ") || "none"}`);

const t1 = Date.now();
const r = await fillLever({
  applicationId: `lever-dry-run-${ref.company}-${ref.postingId.slice(0, 8)}`,
  applyUrl: leverApplyUrl(ref.company, ref.postingId, ref.eu),
  answers: plan.answers,
  profile,
  live: false, // never submit from this script
});
console.log(`\nDry run: ${r.outcome} in ${((Date.now() - t1) / 1000).toFixed(1)}s ${r.error ?? ""}`);
r.log.forEach((l) => console.log("  " + l));
console.log("Screenshot:", r.screenshotPath);
process.exit(0);
