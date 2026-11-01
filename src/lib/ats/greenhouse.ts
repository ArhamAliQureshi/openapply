import "server-only";
import type { FormField } from "@/lib/apply/types";

// Greenhouse publishes every job and its full application form through the public
// Job Board API: https://developers.greenhouse.io/job-board.html

const API = "https://boards-api.greenhouse.io/v1/boards";

type GhValue = { label: string; value: string | number };
type GhField = { name: string; type: string; values?: GhValue[] };
type GhQuestion = { label: string; required: boolean; description?: string | null; fields: GhField[] };
type GhDemographicQuestion = {
  id: number;
  label: string;
  required: boolean;
  type: string;
  answer_options: { id: number; label: string; decline_to_answer: boolean }[];
};

export type GreenhouseJob = {
  id: number;
  title: string;
  company_name?: string;
  absolute_url: string;
  content?: string;
  location: { name: string };
  questions: GhQuestion[];
  location_questions?: GhQuestion[];
  compliance?: { type: string; questions: GhQuestion[] }[] | null;
  demographic_questions?: { questions: GhDemographicQuestion[] } | null;
};

export class GreenhouseError extends Error {}

/** Accepts job-boards.greenhouse.io/{board}/jobs/{id}, boards.greenhouse.io/{board}/jobs/{id}, or embed URLs. */
export function parseGreenhouseUrl(input: string): { board: string; jobId: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)greenhouse\.io$/.test(url.hostname)) return null;
  const path = url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
  if (path) return { board: path[1], jobId: path[2] };
  const board = url.searchParams.get("for");
  const jobId = url.searchParams.get("token") ?? url.searchParams.get("gh_jid");
  return board && jobId ? { board, jobId } : null;
}

export async function fetchGreenhouseJob(board: string, jobId: string): Promise<GreenhouseJob> {
  const res = await fetch(`${API}/${encodeURIComponent(board)}/jobs/${encodeURIComponent(jobId)}?questions=true`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new GreenhouseError("That job no longer exists on Greenhouse.");
  if (!res.ok) throw new GreenhouseError(`Greenhouse returned ${res.status}.`);
  return (await res.json()) as GreenhouseJob;
}

export const greenhouseApplyUrl = (board: string, jobId: string) =>
  `https://job-boards.greenhouse.io/${board}/jobs/${jobId}`;

function kindFor(type: string): FormField["kind"] | null {
  switch (type) {
    case "input_text":
      return "text";
    case "textarea":
      return "textarea";
    case "input_file":
      return "file";
    case "multi_value_single_select":
      return "select";
    case "multi_value_multi_select":
      return "multiselect";
    case "input_hidden":
      return "hidden";
    default:
      return null;
  }
}

const isDecline = (label: string) => /decline|don.?t wish|not wish|prefer not|choose not/i.test(label);

/** Flattens Greenhouse's question groups into one list of fillable fields. */
export function greenhouseFields(job: GreenhouseJob): FormField[] {
  const fields: FormField[] = [];

  const add = (q: GhQuestion, group: FormField["group"]) => {
    // A question can offer several inputs (e.g. resume file OR pasted text). We fill the first.
    const f = q.fields[0];
    if (!f) return;
    const kind = f.name === "location" ? "location" : kindFor(f.type);
    if (!kind || kind === "hidden") return;
    const description = q.description ? htmlText(q.description) : "";
    fields.push({
      id: f.name,
      label: q.label,
      ...(description ? { description } : {}),
      kind,
      required: q.required,
      options: (f.values ?? []).map((v) => ({ label: v.label, decline: isDecline(v.label) })),
      group: group === "custom" && STANDARD.has(f.name) ? "standard" : group,
    });
  };

  job.questions.forEach((q) => add(q, "custom"));
  job.location_questions?.forEach((q) => add(q, "standard"));
  job.compliance?.forEach((c) =>
    c.questions.forEach((q) => {
      // Greenhouse's EEOC block asks "Are you Hispanic/Latino?" first and only shows Race after "No".
      // The API lists only Race, so add the Hispanic question it renders.
      if (q.fields[0]?.name === "race") {
        fields.push({
          id: "hispanic_ethnicity",
          label: "Are you Hispanic/Latino?",
          kind: "select",
          required: q.required,
          options: ["Yes", "No", "Decline To Self Identify"].map((label) => ({ label, decline: isDecline(label) })),
          group: "eeo",
        });
      }
      add(q, "eeo");
    }),
  );
  job.demographic_questions?.questions.forEach((q) => {
    const kind = kindFor(q.type);
    if (!kind) return;
    fields.push({
      id: String(q.id),
      label: q.label,
      kind,
      required: q.required,
      options: q.answer_options.map((o) => ({ label: o.label, decline: o.decline_to_answer || isDecline(o.label) })),
      group: "eeo",
    });
  });
  return fields;
}

const STANDARD = new Set(["first_name", "last_name", "preferred_name", "email", "phone", "resume", "cover_letter"]);

/** Plain-text job description for the AI (Greenhouse returns HTML-escaped HTML). */
export function greenhouseDescription(job: GreenhouseJob): string {
  return htmlText(job.content ?? "");
}

function htmlText(escaped: string): string {
  const html = escaped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
  return html
    .replace(/<\/(p|li|h\d|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
