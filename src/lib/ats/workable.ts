import "server-only";
import type { FormField } from "@/lib/apply/types";

// Workable publishes jobs and their application forms through the same public, read-only JSON
// endpoints its hosted careers page uses (apply.workable.com/api/…): the job (v2), the account
// (company name) and the form definition (v1 /jobs/{shortcode}/form). No HTML parsing needed.

const API = "https://apply.workable.com/api";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export type WorkableRef = { account: string; shortcode: string };

type WorkableFieldDef = {
  id: string;
  label?: string;
  type: string; // text, email, phone, paragraph, boolean, dropdown, multiple, date, number, file, group
  required?: boolean;
  singleOption?: boolean;
  onlyTrueAllowed?: boolean;
  options?: { name: string; value: string }[];
  fields?: WorkableFieldDef[];
};
type WorkableSection = { name?: string; fields: WorkableFieldDef[] };

type WorkableLocation = { city?: string; region?: string; country?: string; countryCode?: string; hidden?: boolean };

export type WorkableJob = {
  shortcode: string;
  account: string;
  title: string;
  company: string;
  location: string; // e.g. "Paris, Île-de-France, France (Remote)"
  jobUrl: string;
  applyUrl: string;
  descriptionHtml: string;
  form: WorkableSection[];
};

export class WorkableError extends Error {}

/** Accepts apply.workable.com/{account}/j/{shortcode}[/apply]. */
export function parseWorkableUrl(input: string): WorkableRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.hostname !== "apply.workable.com") return null;
  const m = url.pathname.match(/^\/([^/]+)\/j\/([0-9a-z]{6,12})(\/apply)?\/?$/i);
  return m ? { account: decodeURIComponent(m[1]).toLowerCase(), shortcode: m[2].toUpperCase() } : null;
}

export const workableJobUrl = (account: string, shortcode: string) =>
  `https://apply.workable.com/${encodeURIComponent(account)}/j/${shortcode}/`;
export const workableApplyUrl = (account: string, shortcode: string) => `${workableJobUrl(account, shortcode)}apply/`;

async function getJson<T>(url: string, what: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json", "user-agent": UA } });
  if (res.status === 404) throw new WorkableError(`That ${what} no longer exists on Workable.`);
  if (res.status === 429) throw new WorkableError("Workable is rate-limiting requests; try again in a few minutes.");
  if (!res.ok) throw new WorkableError(`Workable returned ${res.status}.`);
  return (await res.json()) as T;
}

type JobApi = {
  shortcode: string;
  title: string;
  remote?: boolean;
  workplace?: string;
  location?: WorkableLocation;
  locations?: WorkableLocation[];
  state?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
};

const placeName = (l: WorkableLocation) => [l.city, l.region, l.country].filter((s) => s?.trim()).join(", ");

/** Reads the job, the company name and the application form (three read-only GETs). */
export async function fetchWorkableJob(ref: WorkableRef): Promise<WorkableJob> {
  const { account, shortcode } = ref;
  const [job, acct, form] = await Promise.all([
    getJson<JobApi>(`${API}/v2/accounts/${encodeURIComponent(account)}/jobs/${shortcode}`, "job"),
    getJson<{ name?: string }>(`${API}/v1/accounts/${encodeURIComponent(account)}`, "company").catch(() => null),
    getJson<WorkableSection[]>(`${API}/v1/jobs/${shortcode}/form`, "application form"),
  ]);
  if (job.state && job.state !== "published") throw new WorkableError("That job is no longer open on Workable.");

  // Every listed location (city, region, country) so work-authorization rules can match the country.
  const places = (job.locations?.length ? job.locations : job.location ? [job.location] : [])
    .filter((l) => !l.hidden)
    .map(placeName)
    .filter(Boolean);
  const remote = job.remote || job.workplace === "remote" ? " (Remote)" : "";

  return {
    shortcode: job.shortcode ?? shortcode,
    account,
    title: job.title,
    company: acct?.name ?? account,
    location: `${[...new Set(places)].join("; ")}${remote}`.trim(),
    jobUrl: workableJobUrl(account, shortcode),
    applyUrl: workableApplyUrl(account, shortcode),
    descriptionHtml: [job.description, job.requirements, job.benefits].filter((s) => s?.trim()).join("\n"),
    form: Array.isArray(form) ? form : [],
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
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();

/** Plain-text job description for the AI. */
export const workableDescription = (job: WorkableJob) => htmlToText(job.descriptionHtml).replace(/\n{3,}/g, "\n\n");

// Workable's built-in field ids → the ids planApplication already fills from the profile.
// "address" is a plain text input ("city, region, country") that Workable prefills from the
// visitor's IP, so it maps to the profile location.
const STANDARD_ID: Record<string, string> = {
  firstname: "first_name",
  lastname: "last_name",
  email: "email",
  phone: "phone",
  resume: "resume",
  address: "location",
  cover_letter: "cover_letter",
};
const STANDARD = new Set(Object.values(STANDARD_ID));

/** The DOM `name` / `data-ui` of a FormField id (inverse of STANDARD_ID). */
export const workableDomName = (id: string) => Object.entries(STANDARD_ID).find(([, v]) => v === id)?.[0] ?? id;

export const WORKABLE_GDPR_LABEL =
  "I have read and accept the Privacy Notice and consent to the processing of my data as part of this application.";

const isDecline = (label: string) => /decline|don.?t wish|not wish|prefer not|choose not|not to (say|answer|disclose)/i.test(label);

function kindFor(f: WorkableFieldDef): FormField["kind"] | null {
  switch (f.type) {
    case "text":
    case "email":
    case "phone":
    case "number":
    case "date": // typed as text; the filler fills the date input
      return "text";
    case "paragraph":
      return "textarea";
    case "file":
      return "file";
    case "boolean":
      return "select";
    case "dropdown":
      return f.singleOption === false ? "multiselect" : "select";
    case "multiple":
      return f.singleOption ? "select" : "multiselect";
    default:
      return null; // "group" (education / experience history) is not fillable yet
  }
}

/** Flattens Workable's form sections into fillable fields. Ids are the inputs' `name`s (standard ones renamed). */
export function workableFields(job: WorkableJob): FormField[] {
  const fields: FormField[] = [];
  for (const section of job.form) {
    for (const f of section.fields ?? []) {
      const kind = kindFor(f);
      if (!kind) continue;
      const id = STANDARD_ID[f.id] ?? f.id;
      const gdpr = f.id === "gdpr";
      const options =
        f.type === "boolean"
          ? (f.onlyTrueAllowed ? ["Yes"] : ["Yes", "No"]).map((label) => ({ label }))
          : (f.options ?? []).map((o) => ({ label: o.value.trim(), decline: isDecline(o.value) }));
      fields.push({
        id,
        label: gdpr ? WORKABLE_GDPR_LABEL : (f.label ?? f.id).replace(/ /g, " ").trim(),
        kind,
        required: Boolean(f.required),
        options,
        group: STANDARD.has(id) ? "standard" : "custom",
      });
    }
  }
  return fields;
}
