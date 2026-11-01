import "server-only";
import type { FormField } from "@/lib/apply/types";
import type { Profile } from "@/lib/profile-schema";

// Ashby publishes jobs through the public Job Posting API:
// https://developers.ashbyhq.com/docs/public-job-posting-api
// The application form is not in that API. The hosted job page reads it from Ashby's own
// GraphQL endpoint with the read-only `ApiJobPosting` query, which we call the same way.

const POSTING_API = "https://api.ashbyhq.com/posting-api/job-board";
export const ASHBY_GRAPHQL = "https://jobs.ashbyhq.com/api/non-user-graphql";
/** The only GraphQL operation the dry-run filler lets through (it renders the form). */
export const ASHBY_FORM_QUERY = "ApiJobPosting";

type AshbyFieldDef = {
  path: string;
  title: string;
  type: string;
  selectableValues?: { label: string; value: string }[] | null;
};
type AshbyFieldEntry = { id: string; field: AshbyFieldDef; isRequired: boolean; isHidden?: boolean | null };
type AshbyFormRender = {
  id: string;
  sections: { title: string | null; isHidden?: boolean | null; fieldEntries: AshbyFieldEntry[] }[];
};

export type AshbyJob = {
  id: string;
  org: string;
  title: string;
  company: string;
  location: string; // e.g. "San Francisco, California, United States"
  jobUrl: string;
  applyUrl: string;
  descriptionHtml: string;
  descriptionPlain: string;
  applicationForm: AshbyFormRender | null;
  surveyForms: AshbyFormRender[];
};

type PostingApiJob = {
  id: string;
  title: string;
  location: string;
  address?: { postalAddress?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } } | null;
  jobUrl: string;
  applyUrl: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
};

export class AshbyError extends Error {}

/** Accepts jobs.ashbyhq.com/{org}/{uuid} with an optional /application suffix. */
export function parseAshbyUrl(input: string): { org: string; jobId: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.hostname !== "jobs.ashbyhq.com") return null;
  const m = url.pathname.match(/^\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/application)?\/?$/i);
  return m ? { org: decodeURIComponent(m[1]), jobId: m[2].toLowerCase() } : null;
}

export const ashbyApplyUrl = (org: string, jobId: string) =>
  `https://jobs.ashbyhq.com/${encodeURIComponent(org)}/${jobId}/application`;

const FORM_QUERY = `query ApiJobPosting($organizationHostedJobsPageName: String!, $jobPostingId: String!) {
  jobPosting(organizationHostedJobsPageName: $organizationHostedJobsPageName, jobPostingId: $jobPostingId) {
    id
    applicationForm { ...FormRenderParts }
    surveyForms { ...FormRenderParts }
  }
}
fragment FormRenderParts on FormRender {
  id
  sections { title isHidden fieldEntries { id field isRequired isHidden } }
}`;

const ORG_QUERY = `query ApiOrganizationFromHostedJobsPageName($organizationHostedJobsPageName: String!) {
  organization: organizationFromHostedJobsPageName(organizationHostedJobsPageName: $organizationHostedJobsPageName) { name }
}`;

async function graphql<T>(operationName: string, query: string, variables: Record<string, string>): Promise<T> {
  const res = await fetch(`${ASHBY_GRAPHQL}?op=${operationName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationName, variables, query }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new AshbyError(`Ashby returned ${res.status}.`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (!body.data) throw new AshbyError(`Ashby error: ${body.errors?.[0]?.message ?? "no data"}`);
  return body.data;
}

export async function fetchAshbyJob(org: string, jobId: string): Promise<AshbyJob> {
  const res = await fetch(`${POSTING_API}/${encodeURIComponent(org)}?includeCompensation=true`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new AshbyError("That Ashby job board does not exist.");
  if (!res.ok) throw new AshbyError(`Ashby returned ${res.status}.`);
  const board = (await res.json()) as { jobs?: PostingApiJob[] };
  const posting = board.jobs?.find((j) => j.id.toLowerCase() === jobId);
  if (!posting) throw new AshbyError("That job no longer exists on Ashby.");

  const vars = { organizationHostedJobsPageName: org, jobPostingId: jobId };
  const [form, orgData] = await Promise.all([
    graphql<{ jobPosting: { applicationForm: AshbyFormRender | null; surveyForms: AshbyFormRender[] | null } | null }>(
      ASHBY_FORM_QUERY,
      FORM_QUERY,
      vars,
    ),
    graphql<{ organization: { name: string } | null }>("ApiOrganizationFromHostedJobsPageName", ORG_QUERY, {
      organizationHostedJobsPageName: org,
    }).catch(() => null),
  ]);
  if (!form.jobPosting) throw new AshbyError("That job no longer exists on Ashby.");

  // The posting's own location ("San Francisco") rarely names the country; append it so
  // work-authorization rules can tell which country the job is in.
  const country = posting.address?.postalAddress?.addressCountry;
  const location = country && !posting.location.includes(country) ? `${posting.location}, ${country}` : posting.location;

  return {
    id: posting.id,
    org,
    title: posting.title,
    company: orgData?.organization?.name ?? org,
    location,
    jobUrl: posting.jobUrl,
    applyUrl: ashbyApplyUrl(org, posting.id),
    descriptionHtml: posting.descriptionHtml ?? "",
    descriptionPlain: posting.descriptionPlain ?? "",
    applicationForm: form.jobPosting.applicationForm,
    surveyForms: form.jobPosting.surveyForms ?? [],
  };
}

/** Plain-text job description for the AI. */
export const ashbyDescription = (job: AshbyJob) => job.descriptionPlain.replace(/\n{3,}/g, "\n\n").trim();

function kindFor(type: string): FormField["kind"] | null {
  switch (type) {
    case "String":
    case "Email":
    case "Phone":
    case "Url":
    case "Number":
    case "Date": // typed as text; the filler converts it to the date picker's format
      return "text";
    case "LongText":
      return "textarea";
    case "File":
      return "file";
    case "Boolean":
    case "ValueSelect":
      return "select";
    case "MultiValueSelect":
      return "multiselect";
    case "Location":
      return "location";
    default:
      return null; // e.g. EducationHistory, Score: not fillable yet
  }
}

const isDecline = (label: string) => /decline|don.?t wish|not wish|prefer not|choose not|not to (say|answer|disclose)/i.test(label);

// Ashby field paths that mean the same thing as Greenhouse's standard field names. Using the
// Greenhouse names as FormField ids lets planApplication fill them from the profile unchanged.
// "_systemfield_name" (one full-name input) has no Greenhouse twin and keeps its own id.
const STANDARD_ID: Record<string, string> = {
  _systemfield_email: "email",
  _systemfield_resume: "resume",
  _systemfield_location: "location",
  cover_letter: "cover_letter",
};
export const ASHBY_NAME_ID = "_systemfield_name";
/** Profile values for Ashby-only standard ids; planApplication's STANDARD_VALUES should include these. */
export const ASHBY_STANDARD_VALUES: Record<string, (p: Profile) => string> = {
  [ASHBY_NAME_ID]: (p) => [p.firstName, p.lastName].filter((s) => s.trim()).join(" "),
};
const STANDARD_IDS = new Set([ASHBY_NAME_ID, "email", "phone", "resume", "location", "cover_letter"]);

/** Ashby DOM `data-field-path` for a FormField id ("phone" has no fixed path; the filler finds the tel input). */
export const ashbyPathFor = (id: string) => Object.entries(STANDARD_ID).find(([, v]) => v === id)?.[0] ?? id;

/** Flattens the application form and survey (EEO) forms into one list of fillable fields. */
export function ashbyFields(job: AshbyJob): FormField[] {
  const fields: FormField[] = [];
  let phoneTaken = false;

  const addForm = (form: AshbyFormRender | null, survey: boolean) => {
    for (const section of form?.sections ?? []) {
      if (section.isHidden) continue;
      for (const entry of section.fieldEntries) {
        const f = entry.field;
        const kind = kindFor(f.type);
        if (!kind || entry.isHidden) continue;

        let id = STANDARD_ID[f.path] ?? f.path;
        if (f.type === "Phone" && !phoneTaken) {
          id = "phone";
          phoneTaken = true;
        }
        const options =
          f.type === "Boolean" ? ["Yes", "No"].map((label) => ({ label })) : (f.selectableValues ?? []).map((v) => ({ label: v.label }));
        const eeo = survey || f.path.startsWith("_systemfield_eeoc");
        fields.push({
          id,
          label: f.title.replace(/ /g, " ").trim(),
          kind,
          required: entry.isRequired,
          options: options.map((o) => ({ label: o.label, decline: isDecline(o.label) })),
          group: eeo ? "eeo" : STANDARD_IDS.has(id) || /linked\s?in/i.test(f.title) ? "standard" : "custom",
        });
      }
    }
  };

  addForm(job.applicationForm, false);
  job.surveyForms.forEach((s) => addForm(s, true));
  return fields;
}
