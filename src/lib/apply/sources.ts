import "server-only";
import {
  fetchGreenhouseJob,
  greenhouseApplyUrl,
  greenhouseDescription,
  greenhouseFields,
  parseGreenhouseUrl,
  type GreenhouseJob,
} from "@/lib/ats/greenhouse";
import {
  fetchLeverJob,
  leverApplyUrl,
  leverDescription,
  leverLocation,
  parseLeverUrl,
  type LeverPosting,
} from "@/lib/ats/lever";
import { ashbyApplyUrl, ashbyDescription, ashbyFields, fetchAshbyJob, parseAshbyUrl, type AshbyJob } from "@/lib/ats/ashby";
import { fillAshby } from "./ashby-fill";
import { fillGreenhouse } from "./greenhouse-fill";
import { fillLever } from "./lever-fill";
import type { FormField } from "./types";

// One adapter per applicant-tracking system. Each knows how to read a job link,
// describe its form, and fill it.

export type JobInfo = { fields: FormField[]; company: string; title: string; location: string; description: string };

export type StoredJob = {
  source: string;
  board: string;
  externalId: string;
  url: string;
  applyUrl: string;
  title: string;
  company: string;
  location: string;
  raw: unknown;
};

type Adapter = {
  /** Fetches the job behind a link, or returns null if the link isn't for this ATS. */
  load(url: string): Promise<StoredJob | null>;
  /** Rebuilds the form description from the stored raw job (no network). */
  info(raw: unknown): JobInfo;
  fill: typeof fillGreenhouse;
};

const greenhouse: Adapter = {
  async load(url) {
    const ref = parseGreenhouseUrl(url);
    if (!ref) return null;
    const job = await fetchGreenhouseJob(ref.board, ref.jobId);
    return {
      source: "greenhouse",
      board: ref.board,
      externalId: ref.jobId,
      url: job.absolute_url,
      applyUrl: greenhouseApplyUrl(ref.board, ref.jobId),
      title: job.title,
      company: job.company_name ?? ref.board,
      location: job.location?.name ?? "",
      raw: job,
    };
  },
  info(raw) {
    const job = raw as GreenhouseJob;
    return {
      fields: greenhouseFields(job),
      company: job.company_name ?? "",
      title: job.title,
      location: job.location?.name ?? "",
      description: greenhouseDescription(job),
    };
  },
  fill: fillGreenhouse,
};

type LeverRaw = { posting: LeverPosting; fields: FormField[]; company: string };

const lever: Adapter = {
  async load(url) {
    const ref = parseLeverUrl(url);
    if (!ref) return null;
    const { posting, fields } = await fetchLeverJob(ref);
    const raw: LeverRaw = { posting, fields, company: ref.company };
    return {
      source: "lever",
      board: ref.company,
      externalId: ref.postingId,
      url: posting.hostedUrl,
      applyUrl: leverApplyUrl(ref.company, ref.postingId, ref.eu),
      title: posting.text,
      // Lever's API has no display name; the board slug (e.g. "palantir") stands in.
      company: ref.company,
      location: leverLocation(posting),
      raw,
    };
  },
  info(raw) {
    // The parsed form is stored with the job, so re-planning needs no network.
    const r = raw as LeverRaw;
    return {
      fields: r.fields,
      company: r.company,
      title: r.posting.text,
      location: leverLocation(r.posting),
      description: leverDescription(r.posting),
    };
  },
  fill: fillLever,
};

const ashby: Adapter = {
  async load(url) {
    const ref = parseAshbyUrl(url);
    if (!ref) return null;
    // The stored job includes Ashby's form definition, so re-planning needs no network.
    const job = await fetchAshbyJob(ref.org, ref.jobId);
    return {
      source: "ashby",
      board: ref.org,
      externalId: job.id,
      url: job.jobUrl,
      applyUrl: ashbyApplyUrl(ref.org, job.id),
      title: job.title,
      company: job.company,
      location: job.location,
      raw: job,
    };
  },
  info(raw) {
    const job = raw as AshbyJob;
    return {
      fields: ashbyFields(job),
      company: job.company,
      title: job.title,
      location: job.location,
      description: ashbyDescription(job),
    };
  },
  fill: fillAshby,
};

export const ADAPTERS: Record<string, Adapter> = { greenhouse, lever, ashby };

export const SUPPORTED_HINT =
  "Supported: Greenhouse (job-boards.greenhouse.io/…), Lever (jobs.lever.co/…) and Ashby (jobs.ashbyhq.com/…) job links.";
