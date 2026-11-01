import "server-only";
import type { FormField } from "@/lib/apply/types";

// SmartRecruiters publishes jobs through the public Posting API
// (https://developers.smartrecruiters.com/docs/posting-api): title, company, location and the
// job ad. The application form is NOT public: the Application API's /configuration (screening
// questions) needs a partner X-SmartToken, and the OneClick apply page reads its config from
// /oneclick-ui/api/…/config behind DataDome bot protection. So the form is described as the
// fixed OneClick candidate fields every posting has; per-job screening questions can only be
// seen in the browser (the filler reports them as still empty).

const POSTING_API = "https://api.smartrecruiters.com/v1/companies";

export type SmartRecruitersRef = { company: string; postingId: string };

export type SmartRecruitersPosting = {
  id: string;
  uuid: string;
  name: string; // job title
  company: { identifier: string; name: string };
  location?: {
    city?: string;
    region?: string;
    country?: string; // ISO code, lower case ("us")
    remote?: boolean;
    hybrid?: boolean;
    fullLocation?: string; // "Santa Clara, CALIFORNIA, United States"
  };
  postingUrl?: string;
  applyUrl?: string;
  active?: boolean;
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
};

export class SmartRecruitersError extends Error {}

/** Accepts jobs.smartrecruiters.com/{company}/{postingId}[-slug] (and the OneClick …/publication/{uuid} link's company). */
export function parseSmartRecruitersUrl(input: string): SmartRecruitersRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/^(jobs|careers)\.smartrecruiters\.com$/i.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/([^/]+)\/(\d{6,})(-[^/]*)?\/?$/);
  return m ? { company: decodeURIComponent(m[1]), postingId: m[2] } : null;
}

export const smartRecruitersJobUrl = (company: string, postingId: string) =>
  `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${postingId}`;
/** The OneClick application page for a posting (its uuid, not its numeric id). */
export const smartRecruitersApplyUrl = (company: string, uuid: string) =>
  `https://jobs.smartrecruiters.com/oneclick-ui/company/${encodeURIComponent(company)}/publication/${uuid}?dcr_ci=${encodeURIComponent(company)}`;

export async function fetchSmartRecruitersPosting(ref: SmartRecruitersRef): Promise<SmartRecruitersPosting> {
  const res = await fetch(`${POSTING_API}/${encodeURIComponent(ref.company)}/postings/${ref.postingId}`, {
    signal: AbortSignal.timeout(20_000),
    headers: { accept: "application/json" },
  });
  if (res.status === 404) throw new SmartRecruitersError("That job no longer exists on SmartRecruiters.");
  if (!res.ok) throw new SmartRecruitersError(`SmartRecruiters returned ${res.status}.`);
  const posting = (await res.json()) as SmartRecruitersPosting;
  if (posting.active === false) throw new SmartRecruitersError("That job is no longer open on SmartRecruiters.");
  return posting;
}

const countryName = (code?: string) => {
  if (!code) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
};

/** Job location ending with the country name so work-authorization rules can match. */
export function smartRecruitersLocation(p: SmartRecruitersPosting): string {
  const l = p.location ?? {};
  const country = countryName(l.country);
  let where = l.fullLocation?.trim() || [l.city, l.region].filter(Boolean).join(", ");
  if (country && !where.toLowerCase().includes(country.toLowerCase())) where = [where, country].filter(Boolean).join(", ");
  return `${where}${l.remote ? " (Remote)" : ""}`.trim();
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
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();

/** Plain-text job description for the AI. */
export function smartRecruitersDescription(p: SmartRecruitersPosting): string {
  return Object.values(p.jobAd?.sections ?? {})
    .filter((s): s is { title?: string; text?: string } => Boolean(s?.text?.trim()))
    .map((s) => [s.title ?? "", htmlToText(s.text ?? "")].filter(Boolean).join("\n"))
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The OneClick form's fixed candidate fields, with the ids planApplication fills from the
 * profile. ("Confirm email" is filled by the filler from the email answer.)
 */
export function smartRecruitersFields(): FormField[] {
  const f = (id: string, label: string, kind: FormField["kind"], required: boolean): FormField => ({
    id,
    label,
    kind,
    required,
    options: [],
    group: "standard",
  });
  return [
    f("first_name", "First name", "text", true),
    f("last_name", "Last name", "text", true),
    f("email", "Email", "text", true),
    f("location", "City", "location", true),
    f("phone", "Phone number", "text", false),
    f("resume", "Resume", "file", true),
  ];
}
