// Dev helper: plan + dry-run one Greenhouse job without the web server.
// Usage: npx tsx --conditions=react-server scripts/dry-run.mts <job-url> [sample-resume.pdf]
import { readFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getProfile, planFromUrl, runApplication, saveProfile } from "@/lib/apply/service";

const [url, samplePdf] = process.argv.slice(2);
if (!url) throw new Error("Pass a Greenhouse job URL");

const profile = await getProfile();
if (!profile.email && samplePdf) {
  // Seed a clearly fake test profile so the dry run has data to fill.
  const dir = path.join(process.cwd(), ".data", "files");
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, "sample-resume.pdf");
  await copyFile(samplePdf, dest);
  await saveProfile({
    ...profile,
    firstName: "Priya", lastName: "Raman", email: "priya.raman@example.com", phone: "4155550142",
    phoneCountry: "United States", location: "San Francisco, CA", country: "United States",
    linkedin: "https://www.linkedin.com/in/example-candidate", github: "https://github.com/example-candidate",
    currentTitle: "Senior Software Engineer", currentCompany: "Stripe",
    workAuthorizations: [{ country: "United States", authorized: true, needsSponsorship: false }],
    aboutMe: readFileSync(samplePdf).length ? "Senior software engineer with 8 years building payments and data platforms at Stripe and Airbnb. Led a redesign of card authorization retries that cut false declines by 12%, built a Kafka ledger reconciliation pipeline (2B events/day), and mentored 6 engineers." : "",
    resumeFile: { path: dest, filename: "sample-resume.pdf" },
  });
  console.log("Seeded sample profile");
}

const t0 = Date.now();
const id = await planFromUrl(url);
const db = await getDb();
const [app] = await db.select().from(schema.applications).where(eq(schema.applications.id, id));
console.log(`Planned in ${((Date.now() - t0) / 1000).toFixed(1)}s → status ${app.status}`);
for (const a of app.plan.answers) console.log(`  [${a.source}] ${a.label} = ${String(Array.isArray(a.value) ? a.value.join(", ") : a.value).slice(0, 90).replace(/\n/g, " ")}`);
for (const m of app.plan.missing) console.log(`  [MISSING] ${m.label} — ${m.reason}`);
console.log(`  skipped optional: ${app.plan.skipped.map((s) => s.label).join(", ") || "none"}`);

if (app.status === "ready") {
  const t1 = Date.now();
  const r = await runApplication(id, false);
  console.log(`Dry run: ${r.outcome} in ${((Date.now() - t1) / 1000).toFixed(1)}s ${r.error ?? ""}`);
  r.log.forEach((l) => console.log("  " + l));
  console.log("Screenshot:", r.screenshotPath);
}
process.exit(0);
