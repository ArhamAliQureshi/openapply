import type { Profile, WorkAuthorization } from "@/lib/profile-schema";
import type { ApplicationPlan, FormField, MissingAnswer, PlannedAnswer } from "./types";

// Decides an answer for every form field from the profile, the answer library and fixed rules.
// Principle: never guess. If a required answer isn't known, it goes to `missing` for the user.

export type PlanContext = {
  company: string;
  jobLocation: string;
};

/** Normalized question text, used as the answer-library key. */
export const questionKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Like questionKey, with the company's name replaced so answers carry over between companies. */
export const genericQuestionKey = (label: string, company: string) => {
  const key = questionKey(label);
  const names = [...new Set([company, company.replace(/[-_]/g, " ")].map(questionKey).filter((n) => n.length >= 2))];
  return names.reduce((k, n) => k.replace(new RegExp(`\\b${n}\\b`, "g"), "the company"), key);
};

const COUNTRY_ALIASES: Record<string, string[]> = {
  "united states": ["united states", "u s", "us", "usa", "u s a", "america"],
  "united kingdom": ["united kingdom", "uk", "u k", "great britain", "britain", "england"],
  canada: ["canada"],
  germany: ["germany", "deutschland"],
  "united arab emirates": ["united arab emirates", "uae", "u a e", "dubai", "abu dhabi"],
  "saudi arabia": ["saudi arabia", "ksa", "riyadh"],
  india: ["india"],
  pakistan: ["pakistan"],
  australia: ["australia"],
  netherlands: ["netherlands", "holland"],
  ireland: ["ireland"],
  france: ["france"],
  spain: ["spain"],
  singapore: ["singapore"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const has = (s: string) => s.trim().length > 0;

/** Finds a country mentioned in free text (e.g. a question), returning its canonical name. */
export function countryIn(text: string): string | null {
  const t = ` ${norm(text)} `;
  for (const [canonical, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.some((a) => t.includes(` ${a} `))) return canonical;
  }
  // "San Francisco, CA" / "Austin, TX": a trailing US state code means the United States.
  if (US_STATE_RE.test(text)) return "united states";
  return null;
}

const US_STATE_RE =
  /,\s*(A[LKZR]|C[AOT]|D[EC]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\b/;

function authFor(profile: Profile, country: string | null): WorkAuthorization | null {
  if (!country) return null;
  return profile.workAuthorizations.find((w) => (countryIn(w.country) ?? norm(w.country)) === country) ?? null;
}

// When "How did you hear about us?" offers fixed options, prefer these (in order).
const HEARD_PREFERENCE = [/company (website|site|career)|career(s)? (page|site)|website/i, /job board|online job|job (site|posting)/i, /^other\b/i];

/** Picks the option matching a value, treating yes/no and booleans sensibly. */
function pickOption(field: FormField, value: string | boolean): string | null {
  const labels = field.options.map((o) => o.label);
  if (typeof value === "boolean") {
    return labels.find((l) => (value ? /^yes\b/i : /^no\b/i).test(l.trim())) ?? null;
  }
  const v = norm(value);
  return (
    labels.find((l) => norm(l) === v) ??
    labels.find((l) => norm(l).startsWith(v) || v.startsWith(norm(l))) ??
    null
  );
}

const declineOption = (field: FormField) => field.options.find((o) => o.decline)?.label ?? null;

type Rule = { test: RegExp; answer: (p: Profile, f: FormField, ctx: PlanContext) => string | boolean | null };

// Order matters: the first rule whose pattern matches the question decides.
const RULES: Rule[] = [
  { test: /legal first name|first name \(legal\)/i, answer: (p) => p.firstName || null },
  { test: /legal last name|legal surname|legal family name/i, answer: (p) => p.lastName || null },
  { test: /legal (full )?name/i, answer: (p) => fullName(p) || null },
  {
    // "Since obtaining your citizenship…" / "…and when you obtained it" need more than a country list.
    test: /citizenship|citizen of|nationalit/i,
    answer: (p, f) => (p.citizenships.length && !/when|since|date|permanent resident/i.test(f.label) ? p.citizenships.join(", ") : null),
  },
  {
    test: /(held|hold|have|current|active).{0,40}security clearance|clearance level/i,
    answer: (p, f) => {
      if (!p.securityClearance) return null;
      const none = /^(none|no)$/i.test(p.securityClearance.trim());
      // Yes/no question vs. "which level" question.
      if (f.options.some((o) => /^(yes|no)\b/i.test(o.label))) return !none;
      return p.securityClearance;
    },
  },
  {
    test: /require relocation|need (to )?relocat|need relocation assistance/i,
    answer: (p, _f, ctx) => {
      const here = locatedIn(p, ctx.jobLocation);
      return here === null ? null : !here;
    },
  },
  {
    test: /sponsor.{0,60}(your|current) location|(your|current) location.{0,60}sponsor/i,
    answer: (p) => authFor(p, countryIn(`${p.country} ${p.location}`))?.needsSponsorship ?? null,
  },
  { test: /eligible to begin employment|legally eligible|eligible to start/i, answer: (p, f, ctx) => authFor(p, countryIn(f.label) ?? countryIn(ctx.jobLocation))?.authorized ?? null },
  { test: /linked\s?in/i, answer: (p) => p.linkedin || null },
  { test: /github/i, answer: (p) => p.github || null },
  { test: /^other website/i, answer: (p) => p.website || null },
  { test: /website|portfolio|personal (site|url)/i, answer: (p) => p.website || p.github || null },
  {
    test: /require.*sponsor|need.*sponsor|sponsorship/i,
    answer: (p, f, ctx) => {
      const a = authFor(p, countryIn(f.label) ?? countryIn(ctx.jobLocation));
      return a ? a.needsSponsorship : null;
    },
  },
  {
    test: /(legally )?(authori[sz]ed|eligible|permitted|right) to work/i,
    answer: (p, f, ctx) => {
      const a = authFor(p, countryIn(f.label) ?? countryIn(ctx.jobLocation));
      return a ? a.authorized : null;
    },
  },
  {
    // "Are you currently based in or willing to relocate to the Bay Area?"
    test: /relocat/i,
    answer: (p, f) => {
      const here = locatedIn(p, f.label);
      if (here === true || p.willingToRelocate) return true;
      // "Are you open to relocation?" names no place: the profile setting answers it.
      return here === false || !/\b[A-Z][a-z]+/.test(f.label.replace(/^\W*\w+/, "")) ? false : null;
    },
  },
  { test: /(currently|presently) (located|based|living|reside)|do you (live|reside) in/i, answer: (p, f) => locatedIn(p, f.label) },
  {
    // "Are you able to work in-person in San Francisco?" / "…from our US office three days per week?"
    test: /able to (work|commit)[^?]{0,40}(in[- ]person|on[- ]?site|office)|commute to/i,
    answer: (p, f, ctx) => {
      const here = locatedIn(p, f.label) ?? locatedIn(p, ctx.jobLocation);
      if (here === true) return true;
      return p.willingToRelocate ? true : null;
    },
  },
  { test: /18 years|over 18|at least 18|age of 18/i, answer: (p) => p.over18 },
  { test: /how did you (hear|find|learn)|where did you (hear|see|find)|source/i, answer: (p) => p.howDidYouHear || null },
  { test: /salary|compensation|pay expectation/i, answer: (p) => p.salaryExpectation || null },
  { test: /notice period|start date|when can you start|available to start|earliest/i, answer: (p) => p.noticePeriod || null },
  { test: /current (company|employer)/i, answer: (p) => p.currentCompany || null },
  { test: /current (job )?(title|role|position)/i, answer: (p) => p.currentTitle || null },
  { test: /^(full )?name$/i, answer: (p) => [p.firstName, p.lastName].filter(has).join(" ") || null },
  {
    test: /where (do|will|would) you (intend|plan|expect) to (work|be based)|intend to work from|preferred work location/i,
    answer: (p, f) => (f.options.length ? (countryIn(`${p.country} ${p.location}`) ? p.country || p.location : p.location) : p.location) || null,
  },
  { test: /^(country|country of residence)$/i, answer: (p) => p.country || null },
  { test: /^(city|current (city|location)|location)$/i, answer: (p) => p.location || null },
];

/** true/false when the profile clearly is/isn't in the place named in the question; null if unknown. */
function locatedIn(p: Profile, question: string): boolean | null {
  const where = ` ${norm(`${p.location} ${p.country}`)} `;
  if (!where.trim()) return null;
  const country = countryIn(question);
  if (country) {
    const mine = countryIn(where);
    return mine ? mine === country : null;
  }
  // City/region names: look for any capitalised place word from the question in the profile location.
  const places = question.match(/\b(?:the )?([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)*)\b/g) ?? [];
  const candidates = places.map((x) => norm(x.replace(/^the /i, ""))).filter((x) => x.length > 2 && !/^(are|do|will|is|yes|no)$/.test(x));
  if (candidates.some((c) => where.includes(` ${c} `))) return true;
  if (/bay area/i.test(question)) return /san francisco|oakland|san jose|palo alto|mountain view|berkeley/.test(where);
  return null;
}

const fullName = (p: Profile) => [p.firstName, p.lastName].filter(has).join(" ");

const PAST_EMPLOYMENT_RE =
  /(been |ever |previously |currently )?(employed|worked|work(ed)? (for|at)|contract(or)?|consult(ant|ing)?|intern(ed)?|(current|former) (an )?employee|subsidiar)/i;

/** "Have you ever worked for {company}?": answered from the profile's past employers (only if the user listed them). */
function pastEmploymentAnswer(p: Profile, f: FormField, ctx: PlanContext): boolean | null {
  if (!p.pastEmployers.length || !PAST_EMPLOYMENT_RE.test(f.label)) return null;
  if (/applied|interview/i.test(f.label)) return null; // "previously applied" is a different question
  const worked = (name: string) => p.pastEmployers.some((e) => norm(e) === name || norm(e).startsWith(`${name} `));
  const q = ` ${norm(f.label)} `;
  const company = norm(ctx.company);
  if (company && q.includes(` ${company} `)) return worked(company);
  // A named organisation, e.g. a parent company: "Have you been employed by Amazon or any Amazon subsidiary?"
  const named = f.label.match(/(?:employed (?:by|at|with)|work(?:ed)? (?:for|at)|employee (?:of|at)|contract(?:or)? (?:work )?for|currently an? )\s*([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)/);
  if (named && !/^(Us|Our|The|A|An|This)$/.test(named[1])) return worked(norm(named[1]));
  return null;
}

// Certifications/consents that only need agreement ("I certify…", "By clicking accept…").
const ATTESTATION_RE = /\bi (certify|confirm|acknowledge|agree|understand|consent|attest)\b|by (clicking|submitting|checking)|with your (permission|consent)|consent to|arbitration|acknowledg/i;
const AGREE_OPTION_RE = /^(yes|i agree|agree|accept|i accept|i consent|i acknowledge|i understand|i confirm|i certify|acknowledged|confirm)/i;

/** Questions about motivation or experience that the AI can answer from the candidate background. */
const OPEN_ENDED_RE =
  /\bwhy\b|what (excites|interests|draws|attracts|motivates)|tell us (about|why|more)|describe (a|an|your|how|the)|interest(ed)? in (this|the|joining)|cover letter|anything else|additional information|about yourself|what makes you/i;
const FACTUAL_RE = /citizen|nationalit|clearance|visa|passport|export|criminal|convict|salary|compensation|date|address|social security|reference|referr/i;
export const isOpenEnded = (label: string) => OPEN_ENDED_RE.test(label) && !FACTUAL_RE.test(label);

const STANDARD_VALUES: Record<string, (p: Profile) => string> = {
  // Greenhouse ids, plus Lever's "name"/"org" and Ashby's "_systemfield_name".
  name: fullName,
  _systemfield_name: fullName,
  org: (p) => p.currentCompany,
  first_name: (p) => p.firstName,
  last_name: (p) => p.lastName,
  preferred_name: (p) => p.preferredName,
  email: (p) => p.email,
  phone: (p) => p.phone,
  location: (p) => p.location,
};

const EEO_KEYS: [RegExp, keyof Profile["eeo"]][] = [
  [/gender|sex/i, "gender"],
  [/hispanic|latino/i, "hispanic"],
  [/race|ethnic/i, "race"],
  [/veteran/i, "veteran"],
  [/disabilit/i, "disability"],
];

export function planApplication(
  fields: FormField[],
  profile: Profile,
  library: Map<string, string>,
  ctx: PlanContext,
): ApplicationPlan & { needsAi: FormField[] } {
  const answers: PlannedAnswer[] = [];
  const missing: MissingAnswer[] = [];
  const skipped: ApplicationPlan["skipped"] = [];
  const needsAi: FormField[] = [];

  // Labels shown to the user (and saved to the library) are the form's own label.
  const shown = (f: FormField) => fields.find((x) => x.id === f.id)?.label ?? f.label;
  const answer = (f: FormField, value: string | string[], source: PlannedAnswer["source"]) =>
    answers.push({ fieldId: f.id, label: shown(f), kind: f.kind, value, source });
  const miss = (f: FormField, reason: string) => {
    const label = shown(f);
    const detail = fields.find((x) => x.id === f.id)?.description;
    if (f.required) {
      missing.push({ fieldId: f.id, label, ...(detail ? { detail } : {}), kind: f.kind, required: true, options: f.options.map((o) => o.label), reason });
    }
    else skipped.push({ fieldId: f.id, label });
  };

  for (const field of fields) {
    // Rules match on the full question text; library keys stay on the label.
    const f: FormField = field.description ? { ...field, label: `${field.label} ${field.description}` } : field;
    const keyLabel = field.label;
    // Files.
    if (f.kind === "file") {
      if (f.id === "resume" && profile.resumeFile) answer(f, profile.resumeFile.path, "profile");
      else miss(f, f.id === "resume" ? "Upload your resume PDF on the Profile page." : "A file is required.");
      continue;
    }

    // Standard contact fields.
    if (STANDARD_VALUES[f.id]) {
      const v = STANDARD_VALUES[f.id](profile);
      if (has(v)) answer(f, v, "profile");
      else miss(f, "Add this to your profile.");
      continue;
    }

    // Past employment is decided from the profile, so a saved "No" never hides a real "Yes".
    const employed = pastEmploymentAnswer(profile, f, ctx);
    if (employed !== null) {
      const opt = f.options.length ? pickOption(f, employed) : employed ? "Yes" : "No";
      if (opt) {
        answer(f, f.kind === "multiselect" ? [opt] : opt, "profile");
        continue;
      }
    }

    // Answer library: the user's own past answers win over rules. Exact question first, then
    // the same question asked by another company.
    const saved = library.get(questionKey(keyLabel)) ?? library.get(genericQuestionKey(keyLabel, ctx.company));
    if (saved !== undefined) {
      if (f.kind === "select" || f.kind === "multiselect") {
        const opt = pickOption(f, saved);
        if (opt) {
          answer(f, f.kind === "multiselect" ? [opt] : opt, "library");
          continue;
        }
      } else {
        answer(f, saved, "library");
        continue;
      }
    }

    // Equal-opportunity questions: use the profile choice, otherwise decline.
    if (f.group === "eeo") {
      const key = EEO_KEYS.find(([re]) => re.test(f.label))?.[1];
      const chosen = key && profile.eeo[key] ? pickOption(f, profile.eeo[key]) : null;
      const value = chosen ?? declineOption(f);
      if (value) answer(f, f.kind === "multiselect" ? [value] : value, chosen ? "profile" : "default");
      else miss(f, "No 'decline to answer' option; choose an answer.");
      continue;
    }

    // Certifications and consents: only when the user opted in.
    if (profile.autoAcceptAttestations && ATTESTATION_RE.test(f.label)) {
      const agree = f.options.find((o) => AGREE_OPTION_RE.test(o.label.trim()))?.label;
      if (agree) {
        answer(f, f.kind === "multiselect" ? [agree] : agree, "rule");
        continue;
      }
    }

    // Fixed rules.
    if (/how did you (hear|find|learn)|where did you (hear|see|find)/i.test(f.label) && f.options.length) {
      const opt = HEARD_PREFERENCE.map((re) => f.options.find((o) => re.test(o.label))?.label).find(Boolean);
      if (opt) {
        answer(f, f.kind === "multiselect" ? [opt] : opt, "rule");
        continue;
      }
    }

    const rule = RULES.find((r) => r.test.test(f.label));
    const ruled = rule?.answer(profile, f, ctx) ?? null;
    if (ruled !== null && ruled !== "") {
      if (f.kind === "select" || f.kind === "multiselect") {
        const opt = pickOption(f, ruled);
        if (opt) {
          answer(f, f.kind === "multiselect" ? [opt] : opt, "rule");
          continue;
        }
      } else if (typeof ruled === "string") {
        answer(f, ruled, "rule");
        continue;
      } else {
        answer(f, ruled ? "Yes" : "No", "rule");
        continue;
      }
    }

    // Open-ended questions ("Why do you want to work here?") may be written by the AI, only when
    // required. Factual questions (citizenship, clearance, dates…) always go to the user.
    if (f.kind === "textarea" && f.required && profile.aiWrittenAnswers && isOpenEnded(f.label)) {
      needsAi.push(f);
      continue;
    }

    miss(f, "No saved answer for this question.");
  }

  return { answers, missing, skipped, needsAi };
}
