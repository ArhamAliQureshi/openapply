import type { Resume } from "./resume-schema";

// Deterministic clean-up applied to every model's output (local or Claude).
// Fixes mistakes that are easy to detect without a model: non-URL "links",
// repeated text, dates stuffed into degree fields, and duplicate entries.

const URL_RE = /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
const URL_IN_TEXT_RE = /\b(?:https?:\/\/)?(?:www\.)?(linkedin\.com\/in\/[\w-]+|github\.com\/[\w-]+)\/?(?=[\s,·|)]|$)/gi;
const TRAILING_YEARS_RE = /[,\s(–-]*\b(19|20)\d{2}\b(\s*[–-]\s*(\b(19|20)\d{2}\b|present))?\)?\s*$/i;

const EMPTY_WORDS = new Set(["null", "none", "n/a", "na", "undefined", "-"]);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tidy = (s: string) => (EMPTY_WORDS.has(s.trim().toLowerCase()) ? "" : s.trim());
const tidyList = (xs: string[]) => xs.map(tidy).filter(Boolean);
const isUrl = (s: string) => URL_RE.test(s.trim());
const urlKey = (s: string) => s.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").replace(/\/$/, "");

// True when `inner` adds nothing beyond `outer` (ignoring case and punctuation).
const repeats = (inner: string, outer: string) => !!norm(inner) && norm(outer).includes(norm(inner));

function dedupe<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function networkFor(url: string) {
  const host = urlKey(url).split("/")[0];
  if (host.includes("linkedin")) return "LinkedIn";
  if (host.includes("github")) return "GitHub";
  return host;
}

// Small models sometimes repeat a project, certification or degree as a job (or vice versa).
// Section headings like "PROJECTS" leaking into a field are a reliable sign of this.
const isSectionHeading = (s: string) => /^[A-Z &/]{4,}$/.test(s.trim());

export function cleanResume(resume: Resume, sourceText = ""): Resume {
  const b = resume.basics;
  const projectNames = new Set(resume.projects.map((p) => norm(p.name)).filter(Boolean));
  const certNames = resume.certifications.flatMap((c) => [norm(c.name), norm(c.issuer)]).filter(Boolean);
  const isCert = (s: string) => !!norm(s) && certNames.some((c) => c.includes(norm(s)));
  const companies = new Set(resume.work.map((w) => norm(w.company)).filter(Boolean));

  // Links: keep only real URLs, then add LinkedIn/GitHub profiles written in the
  // source but missed by the model.
  let profiles = b.profiles
    .map((p) => ({ network: tidy(p.network), url: tidy(p.url) }))
    .filter((p) => isUrl(p.url));
  for (const match of sourceText.matchAll(URL_IN_TEXT_RE)) {
    const url = match[0].trim().replace(/\/$/, "");
    // Skip project repos like github.com/user/repo: the regex only matches user-level paths.
    if (!profiles.some((p) => urlKey(p.url) === urlKey(url))) profiles.push({ network: networkFor(url), url });
  }
  profiles = dedupe(profiles, (p) => urlKey(p.url)).map((p) => ({
    ...p,
    network: !p.network || isUrl(p.network) ? networkFor(p.url) : p.network,
  }));

  // Never keep a skill the resume doesn't mention (small models invent them), and
  // don't list certifications as skills. Skipped when there is no source text (e.g. scanned PDF read by Claude).
  const sourceNorm = ` ${norm(sourceText)} `;
  const inSource = (k: string) => !sourceText || sourceNorm.includes(` ${norm(k)} `);

  const work = dedupe(
    resume.work
      .filter((w) => !projectNames.has(norm(w.company)) && !isCert(w.company))
      // A "job" whose company and title match a degree is really an education entry.
      .filter((w) => !resume.education.some((e) => norm(e.institution) === norm(w.company) && (norm(e.studyType) === norm(w.position) || !norm(w.position))))
      .map((w) => {
      const highlights = tidyList(w.highlights);
      // Drop a summary that just restates the bullets.
      const summaryRepeats = highlights.length > 0 && (highlights.every((h) => repeats(h, w.summary)) || highlights.some((h) => repeats(w.summary, h)));
      return { ...w, summary: summaryRepeats ? "" : tidy(w.summary), highlights };
    }),
    (w) => `${norm(w.company)}|${norm(w.position)}|${norm(w.startDate)}`,
  );

  const projects = dedupe(
    resume.projects.map((p) => ({
      ...p,
      highlights: tidyList(p.highlights).filter((h) => !repeats(p.description, h) && !repeats(h, p.description)),
    })),
    (p) => norm(p.name),
  );

  const education = dedupe(
    resume.education
      .filter((e) => !isSectionHeading(e.studyType) && !projectNames.has(norm(e.institution)) && !isCert(e.institution))
      // A degree whose "school" is an employer and "degree" is a job title is really a job.
      .filter((e) => !(companies.has(norm(e.institution)) && resume.work.some((w) => norm(w.company) === norm(e.institution) && norm(w.position) === norm(e.studyType))))
      .map((e) => ({
      ...e,
      // "M.S. Computer Science, 2016-2018" → "M.S. Computer Science"
      studyType: tidy(e.studyType.replace(TRAILING_YEARS_RE, "")),
      area: tidy(e.area.replace(TRAILING_YEARS_RE, "")),
    })),
    (e) => `${norm(e.institution)}|${norm(e.studyType)}|${norm(e.area)}`,
  );

  return {
    ...resume,
    basics: { ...b, url: isUrl(b.url) ? tidy(b.url) : "", profiles },
    work,
    projects,
    education,
    skills: resume.skills
      .map((s) => ({
        name: tidy(s.name),
        keywords: dedupe(tidyList(s.keywords), norm).filter((k) => inSource(k) && !certNames.includes(norm(k))),
      }))
      .filter((s) => s.keywords.length > 0),
    certifications: dedupe(resume.certifications.filter((c) => tidy(c.name)), (c) => norm(c.name)),
    languages: dedupe(resume.languages.filter((l) => tidy(l.language)), (l) => norm(l.language)),
  };
}
