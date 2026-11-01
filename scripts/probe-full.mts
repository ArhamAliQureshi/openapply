// Dev helper: full parse (local model + clean-up) on a file; prints only section counts and timing.
import { readFileSync } from "node:fs";
import { parseResumeFile } from "@/lib/parse-resume";

const file = new File([readFileSync(process.argv[2])], "resume.pdf", { type: "application/pdf" });
const t0 = Date.now();
const { resume: r } = await parseResumeFile(file);
console.log(`secs ${((Date.now() - t0) / 1000).toFixed(0)}`);
console.log(JSON.stringify({
  name: !!r.basics.name, email: !!r.basics.email, phone: !!r.basics.phone, location: !!r.basics.location,
  profiles: r.basics.profiles.length, summaryChars: r.basics.summary.length,
  work: r.work.length, bulletsPerJob: r.work.map((w) => w.highlights.length), education: r.education.length,
  skillGroups: r.skills.length, projects: r.projects.length, certifications: r.certifications.length, languages: r.languages.length,
}));
process.exit(0);
