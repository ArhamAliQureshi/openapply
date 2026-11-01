import "server-only";
import type { FormField } from "@/lib/apply/types";

// Lever publishes jobs through the public Postings API (https://github.com/lever/postings-api),
// but not the application form. The apply page is server-rendered, so we read the form from
// its HTML with a plain GET: standard fields, custom question "cards" (each card embeds its own
// JSON template) and the U.S. EEO selects.

export type LeverRef = { company: string; postingId: string; eu: boolean };

export type LeverPosting = {
  id: string;
  text: string; // job title
  hostedUrl: string;
  applyUrl: string;
  country?: string;
  workplaceType?: string;
  categories: { location?: string; allLocations?: string[]; team?: string; commitment?: string; department?: string };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
};

export class LeverError extends Error {}

/** Accepts jobs.lever.co/{company}/{uuid}[/apply] and jobs.eu.lever.co/…. */
export function parseLeverUrl(input: string): LeverRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.match(/^jobs\.(eu\.)?lever\.co$/);
  if (!host) return null;
  const path = url.pathname.match(/^\/([^/]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/apply)?\/?$/i);
  return path ? { company: path[1], postingId: path[2].toLowerCase(), eu: Boolean(host[1]) } : null;
}

const apiBase = (eu: boolean) => (eu ? "https://api.eu.lever.co/v0/postings" : "https://api.lever.co/v0/postings");
const jobsBase = (eu: boolean) => (eu ? "https://jobs.eu.lever.co" : "https://jobs.lever.co");

export const leverApplyUrl = (company: string, postingId: string, eu = false) =>
  `${jobsBase(eu)}/${company}/${postingId}/apply`;

export async function fetchLeverPosting(company: string, postingId: string, eu = false): Promise<LeverPosting> {
  const res = await fetch(`${apiBase(eu)}/${encodeURIComponent(company)}/${encodeURIComponent(postingId)}?mode=json`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) throw new LeverError("That job no longer exists on Lever.");
  if (!res.ok) throw new LeverError(`Lever returned ${res.status}.`);
  return (await res.json()) as LeverPosting;
}

/** Fetches the server-rendered apply page (plain GET, nothing is submitted). */
export async function fetchLeverApplyPage(company: string, postingId: string, eu = false): Promise<string> {
  const res = await fetch(leverApplyUrl(company, postingId, eu), {
    signal: AbortSignal.timeout(30_000),
    headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" },
  });
  if (res.status === 404) throw new LeverError("That job no longer exists on Lever.");
  if (!res.ok) throw new LeverError(`Lever apply page returned ${res.status}.`);
  return res.text();
}

/** Reads the posting and its application form. */
export async function fetchLeverJob(ref: LeverRef) {
  const [posting, html] = await Promise.all([
    fetchLeverPosting(ref.company, ref.postingId, ref.eu),
    fetchLeverApplyPage(ref.company, ref.postingId, ref.eu),
  ]);
  return { posting, fields: leverFields(html) };
}

/** Plain-text job description for the AI. */
export function leverDescription(p: LeverPosting): string {
  const lists = (p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`);
  return [p.descriptionPlain ?? "", ...lists, p.additionalPlain ?? ""]
    .filter((s) => s.trim())
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Job location plus its country code (e.g. "Washington, D.C., US") so country rules can match. */
export const leverLocation = (p: LeverPosting) =>
  [p.categories.allLocations?.join("; ") || p.categories.location || "", p.country ?? ""].filter(Boolean).join(", ");

// --- Form parsing ---------------------------------------------------------------------------

const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const htmlToText = (html: string) =>
  decode(html.replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decode(m[2] ?? m[3] ?? "") : null;
};

const isDecline = (label: string) =>
  /decline|don.?t wish|not wish|prefer not|choose not|not want to answer|not to (disclose|answer|say)/i.test(label);

const option = (label: string) => ({ label: label.trim(), decline: isDecline(label) });

type CardTemplate = {
  id: string;
  text: string;
  fields: { type: string; text: string; description?: string; required: boolean; options?: { text: string }[] }[];
};

// Lever card field type → our kind. Radios render as "multiple-choice", checkboxes as "multiple-select".
const CARD_KIND: Record<string, FormField["kind"]> = {
  text: "text",
  textarea: "textarea",
  "multiple-choice": "select",
  dropdown: "select",
  "multiple-select": "multiselect",
};

// Contact fields Lever renders on every form. "name" is a single full-name field.
const STANDARD_NAMES = new Set(["resume", "name", "email", "phone", "location", "org", "comments"]);

/** Turns the Lever apply page into fillable fields; ids are the real `name` attributes. */
export function leverFields(html: string): FormField[] {
  const start = html.indexOf('id="application-form"');
  if (start < 0) throw new LeverError("Couldn't find the application form on the Lever page.");
  const end = html.indexOf("</form>", start);
  const form = html.slice(start, end < 0 ? undefined : end);
  const fields: FormField[] = [];
  const seen = new Set<string>();
  const push = (f: FormField) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    fields.push(f);
  };

  // Standard + EEO questions: one `application-question` block each.
  for (const block of form.split(/class="application-question/).slice(1)) {
    const fieldStart = block.search(/<div class="application-field|<div class="application-additional/);
    const labelHtml = fieldStart > 0 ? block.slice(block.indexOf(">") + 1, fieldStart) : "";
    const control = block.slice(Math.max(fieldStart, 0)).match(/<(input|select|textarea)\b[^>]*>/i);
    if (!control) continue;
    const tag = control[0];
    const name = attr(tag, "name");
    const type = (attr(tag, "type") ?? "").toLowerCase();
    // Cards come from their JSON template below; country-gated surveys are optional and skipped.
    if (!name || type === "hidden" || /^(cards|surveysResponses|consent)\[/.test(name)) continue;
    // CC-305 signature/date are filled by the filler together with the disability answer.
    if (/^eeo\[disabilitySignature/.test(name)) continue;
    const isEeo = name.startsWith("eeo[");
    if (!isEeo && !STANDARD_NAMES.has(name) && !name.startsWith("urls[")) continue;

    const label = htmlToText(labelHtml.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "")).replace(/✱/g, "").trim();
    const required = /class="required"/.test(labelHtml) || /\srequired(\s|=|>|\/)/i.test(tag);

    let kind: FormField["kind"] = control[1].toLowerCase() === "textarea" ? "textarea" : "text";
    let options: FormField["options"] = [];
    if (control[1].toLowerCase() === "select") {
      kind = "select";
      const body = block.slice(block.indexOf(tag), block.indexOf("</select>", block.indexOf(tag)));
      options = [...body.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/gi)]
        .filter((m) => attr(`<x${m[1]}>`, "value"))
        .map((m) => option(decode(m[2])));
    } else if (type === "radio" || type === "checkbox") {
      kind = type === "radio" ? "select" : "multiselect";
      const re = new RegExp(`<input\\b[^>]*name="${name.replace(/[[\]]/g, "\\$&")}"[^>]*>`, "gi");
      options = [...block.matchAll(re)].map((m) => option(attr(m[0], "value") ?? ""));
    } else if (type === "file") {
      kind = "file";
    } else if (name === "location") {
      kind = "location";
    }

    push({
      id: name,
      label: label || name,
      kind,
      required,
      options,
      group: isEeo ? "eeo" : "standard",
    });
  }

  // Custom question cards: hidden input `cards[{id}][baseTemplate]` holds the card JSON;
  // its fields render as `cards[{id}][field{i}]`.
  for (const m of form.matchAll(/<input\b[^>]*name="cards\[([^\]]+)\]\[baseTemplate\]"[^>]*>/gi)) {
    const raw = attr(m[0], "value");
    if (!raw) continue;
    let card: CardTemplate;
    try {
      card = JSON.parse(raw) as CardTemplate;
    } catch {
      continue;
    }
    card.fields.forEach((f, i) => {
      const kind = CARD_KIND[f.type];
      if (!kind) return;
      push({
        id: `cards[${m[1]}][field${i}]`,
        label: f.text.trim(),
        kind,
        required: Boolean(f.required),
        options: (f.options ?? []).map((o) => option(o.text)),
        group: "custom",
      });
    });
  }

  // "Additional information" (cover letter) textarea sits outside the question blocks.
  if (/name="comments"/.test(form)) {
    push({ id: "comments", label: "Additional information", kind: "textarea", required: false, options: [], group: "standard" });
  }
  return fields;
}

/** Full name for Lever's single name field (plan.ts maps Greenhouse first/last names). */
export const leverFullName = (p: { firstName: string; lastName: string }) =>
  [p.firstName, p.lastName].filter((s) => s.trim()).join(" ");
