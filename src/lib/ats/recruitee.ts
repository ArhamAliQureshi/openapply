import "server-only";
import type { FormField } from "@/lib/apply/types";

// Recruitee publishes jobs through the public careers-site API ({company}.recruitee.com/api/offers/…),
// which also lists the offer's "open_questions", but with ids that differ from the ones the form
// uses. The hosted apply page (/o/{slug}/c/new) is server-rendered with its full configuration
// in a `data-props` JSON blob (questions with their form ids, required CV/phone/cover letter,
// privacy agreements), so we read the form from that with a plain GET, like Lever.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export type RecruiteeRef = { company: string; slug: string };

export type RecruiteeOffer = {
  id: number;
  slug: string;
  title: string;
  company_name?: string;
  location?: string; // "Utrecht, Utrecht, Netherlands"
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  locations?: { city?: string; state?: string; country?: string }[];
  careers_url: string;
  careers_apply_url: string;
  description?: string;
  requirements?: string;
};

export type RecruiteeJob = {
  offer: RecruiteeOffer;
  company: string;
  location: string;
  applyUrl: string;
  fields: FormField[];
};

export class RecruiteeError extends Error {}

/** Accepts {company}.recruitee.com/o/{slug}[/c/new]. */
export function parseRecruiteeUrl(input: string): RecruiteeRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.match(/^([a-z0-9-]+)\.recruitee\.com$/i);
  if (!host || /^(www|app|api|careers-analytics)$/i.test(host[1])) return null;
  const path = url.pathname.match(/^\/o\/([^/]+)(\/c\/new)?\/?$/i);
  return path ? { company: host[1].toLowerCase(), slug: decodeURIComponent(path[1]) } : null;
}

const base = (company: string) => `https://${company}.recruitee.com`;
export const recruiteeApplyUrl = (company: string, slug: string) => `${base(company)}/o/${encodeURIComponent(slug)}/c/new`;

export async function fetchRecruiteeOffer(ref: RecruiteeRef): Promise<RecruiteeOffer> {
  const res = await fetch(`${base(ref.company)}/api/offers/${encodeURIComponent(ref.slug)}`, {
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "application/json" },
  });
  if (res.status === 404) throw new RecruiteeError("That job no longer exists on Recruitee.");
  if (!res.ok) throw new RecruiteeError(`Recruitee returned ${res.status}.`);
  const body = (await res.json()) as { offer?: RecruiteeOffer };
  if (!body.offer) throw new RecruiteeError("That job no longer exists on Recruitee.");
  return body.offer;
}

/** Fetches the server-rendered apply page (plain GET, follows the redirect to a custom domain). */
export async function fetchRecruiteeApplyPage(url: string): Promise<{ html: string; url: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": UA } });
  if (res.status === 404) throw new RecruiteeError("That job no longer exists on Recruitee.");
  if (!res.ok) throw new RecruiteeError(`Recruitee apply page returned ${res.status}.`);
  return { html: await res.text(), url: res.url };
}

/** Reads the offer and its application form. */
export async function fetchRecruiteeJob(ref: RecruiteeRef): Promise<RecruiteeJob> {
  const offer = await fetchRecruiteeOffer(ref);
  const page = await fetchRecruiteeApplyPage(offer.careers_apply_url || recruiteeApplyUrl(ref.company, ref.slug));
  const config = appConfig(page.html);
  if (!config?.offer) {
    throw new RecruiteeError("This company sends applicants to its own careers site instead of Recruitee's form; apply there.");
  }
  // Country from every location so work-authorization rules can match; the API's "location"
  // ("Utrecht, Utrecht, Netherlands") already ends with it.
  const places = (offer.locations ?? []).map((l) => [l.city, l.state, l.country].filter(Boolean).join(", ")).filter(Boolean);
  const where = [...new Set(places.length ? places : [offer.location ?? ""])].filter(Boolean).join("; ");
  const location = `${where}${offer.remote ? " (Remote)" : ""}`.trim();
  return {
    offer,
    company: offer.company_name || config.site?.name || ref.company,
    location,
    // The page Recruitee redirected us to (custom careers domains keep the same form).
    applyUrl: page.url,
    fields: recruiteeFields(config),
  };
}

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const htmlToText = (html: string) =>
  decode(html.replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();

/** Plain-text job description for the AI. */
export const recruiteeDescription = (job: RecruiteeJob) =>
  [job.offer.description, job.offer.requirements]
    .filter((s): s is string => Boolean(s?.trim()))
    .map(htmlToText)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// --- Form parsing ---------------------------------------------------------------------------

type Translated<T> = { translations?: Record<string, T> };
type OpenQuestion = Translated<{ body: string; options?: string[] }> & {
  id: number;
  kind: string; // string, text, single_choice, multi_choice, boolean, salary, number, date, file, video, infobox
  position: number;
  required: boolean;
};
type RichText = { text?: string; children?: RichText[] };
type AppConfig = {
  site?: { name?: string };
  agreements?: (Translated<{ body: RichText[] }> & { id: number; position: number })[];
  offer?: Translated<{ title?: string }> & {
    primaryLangCode?: string;
    openQuestions?: OpenQuestion[];
    fields?: { cv?: string; phone?: string; coverLetter?: string; photo?: string };
  };
};

function appConfig(html: string): AppConfig | null {
  const m = html.match(/data-component="PublicApp"\s+data-props="([^"]*)"/);
  if (!m) return null;
  try {
    return (JSON.parse(decode(m[1])) as { appConfig?: AppConfig }).appConfig ?? null;
  } catch {
    return null;
  }
}

const tr = <T>(x: Translated<T>, lang?: string): T | undefined =>
  (lang && x.translations?.[lang]) || x.translations?.en || Object.values(x.translations ?? {})[0];

const richText = (nodes: RichText[]): string =>
  nodes.map((n) => (n.text ?? "") + (n.children ? richText(n.children) : "")).join("");

const isDecline = (label: string) => /decline|don.?t wish|not wish|prefer not|choose not|not to (say|answer|disclose)/i.test(label);

const QUESTION_KIND: Record<string, FormField["kind"]> = {
  string: "text",
  text: "textarea",
  single_choice: "select",
  multi_choice: "multiselect",
  boolean: "select",
  salary: "text",
  number: "text",
  date: "text",
  file: "file",
};

/** DOM `name` prefix of an open question; answers live at `.content` (or `.flag` for yes/no). */
export const recruiteeQuestionId = (id: number) => `candidate.openQuestionAnswers.${id}`;

/**
 * Turns the apply page's configuration into fillable fields. Standard fields use the ids
 * planApplication fills from the profile (Recruitee asks for one full "name"); questions and
 * agreements use their DOM `name`s.
 */
export function recruiteeFields(config: AppConfig): FormField[] {
  const offer = config.offer ?? {};
  const lang = offer.primaryLangCode;
  const on = (v?: string) => Boolean(v) && v !== "off";
  const fields: FormField[] = [
    { id: "name", label: "Full name", kind: "text", required: true, options: [], group: "standard" },
    { id: "email", label: "Email address", kind: "text", required: true, options: [], group: "standard" },
  ];
  const f = offer.fields ?? {};
  if (on(f.phone)) fields.push({ id: "phone", label: "Phone number", kind: "text", required: f.phone === "required", options: [], group: "standard" });
  if (on(f.cv)) fields.push({ id: "resume", label: "CV or resume", kind: "file", required: f.cv === "required", options: [], group: "standard" });
  if (on(f.coverLetter)) {
    fields.push({ id: "cover_letter", label: "Cover letter", kind: "textarea", required: f.coverLetter === "required", options: [], group: "standard" });
  }
  if (on(f.photo)) fields.push({ id: "photo", label: "Photo", kind: "file", required: f.photo === "required", options: [], group: "standard" });

  for (const q of [...(offer.openQuestions ?? [])].sort((a, b) => a.position - b.position)) {
    const kind = QUESTION_KIND[q.kind];
    if (!kind) continue; // infobox (text only), video
    const t = tr(q, lang);
    const options = q.kind === "boolean" ? ["Yes", "No"] : (t?.options ?? []).map((o) => o.trim());
    fields.push({
      id: recruiteeQuestionId(q.id),
      label: htmlToText(t?.body ?? "").replace(/\n+/g, " ").trim() || `Question ${q.position}`,
      kind,
      required: q.required,
      options: options.map((label) => ({ label, decline: isDecline(label) })),
      group: "custom",
    });
  }

  // Privacy agreements: one required consent checkbox each.
  [...(config.agreements ?? [])]
    .sort((a, b) => a.position - b.position)
    .forEach((a, i) => {
      const text = richText(tr(a, lang)?.body ?? []).replace(/\s+/g, " ").trim();
      fields.push({
        id: `candidate.agreements.${i}.consent`,
        label: text || "I consent to the processing of my personal data.",
        kind: "select",
        required: true,
        options: [{ label: "Yes" }],
        group: "custom",
      });
    });
  return fields;
}
