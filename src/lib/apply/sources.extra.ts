import "server-only";
import { fetchRecruiteeJob, parseRecruiteeUrl, recruiteeDescription, type RecruiteeJob } from "@/lib/ats/recruitee";
import {
  fetchSmartRecruitersPosting,
  parseSmartRecruitersUrl,
  smartRecruitersApplyUrl,
  smartRecruitersDescription,
  smartRecruitersFields,
  smartRecruitersJobUrl,
  smartRecruitersLocation,
  type SmartRecruitersPosting,
} from "@/lib/ats/smartrecruiters";
import { fetchWorkableJob, parseWorkableUrl, workableDescription, workableFields, type WorkableJob } from "@/lib/ats/workable";
import type { fillGreenhouse } from "./greenhouse-fill";
import { fillRecruitee } from "./recruitee-fill";
import { fillSmartRecruiters } from "./smartrecruiters-fill";
import type { JobInfo, StoredJob } from "./sources";
import { fillWorkable } from "./workable-fill";

// Adapters for Workable, SmartRecruiters and Recruitee, in the same shape as sources.ts's
// (merge into ADAPTERS there). The Adapter type is copied because sources.ts doesn't export it.

type Adapter = {
  /** Fetches the job behind a link, or returns null if the link isn't for this ATS. */
  load(url: string): Promise<StoredJob | null>;
  /** Rebuilds the form description from the stored raw job (no network). */
  info(raw: unknown): JobInfo;
  fill: typeof fillGreenhouse;
};

const workable: Adapter = {
  async load(url) {
    const ref = parseWorkableUrl(url);
    if (!ref) return null;
    // The stored job includes Workable's form definition, so re-planning needs no network.
    const job = await fetchWorkableJob(ref);
    return {
      source: "workable",
      board: ref.account,
      externalId: job.shortcode,
      url: job.jobUrl,
      applyUrl: job.applyUrl,
      title: job.title,
      company: job.company,
      location: job.location,
      raw: job,
    };
  },
  info(raw) {
    const job = raw as WorkableJob;
    return {
      fields: workableFields(job),
      company: job.company,
      title: job.title,
      location: job.location,
      description: workableDescription(job),
    };
  },
  fill: fillWorkable,
};

const smartrecruiters: Adapter = {
  async load(url) {
    const ref = parseSmartRecruitersUrl(url);
    if (!ref) return null;
    const posting = await fetchSmartRecruitersPosting(ref);
    return {
      source: "smartrecruiters",
      board: ref.company,
      externalId: posting.id,
      url: posting.postingUrl ?? smartRecruitersJobUrl(ref.company, posting.id),
      applyUrl: smartRecruitersApplyUrl(posting.company.identifier || ref.company, posting.uuid),
      title: posting.name,
      company: posting.company.name || ref.company,
      location: smartRecruitersLocation(posting),
      raw: posting,
    };
  },
  info(raw) {
    // The application form isn't public: these are OneClick's fixed fields (see smartrecruiters.ts).
    const posting = raw as SmartRecruitersPosting;
    return {
      fields: smartRecruitersFields(),
      company: posting.company.name,
      title: posting.name,
      location: smartRecruitersLocation(posting),
      description: smartRecruitersDescription(posting),
    };
  },
  fill: fillSmartRecruiters,
};

const recruitee: Adapter = {
  async load(url) {
    const ref = parseRecruiteeUrl(url);
    if (!ref) return null;
    // The parsed form is stored with the job, so re-planning needs no network.
    const job = await fetchRecruiteeJob(ref);
    return {
      source: "recruitee",
      board: ref.company,
      externalId: String(job.offer.id),
      url: job.offer.careers_url,
      applyUrl: job.applyUrl,
      title: job.offer.title,
      company: job.company,
      location: job.location,
      raw: job,
    };
  },
  info(raw) {
    const job = raw as RecruiteeJob;
    return {
      fields: job.fields,
      company: job.company,
      title: job.offer.title,
      location: job.location,
      description: recruiteeDescription(job),
    };
  },
  fill: fillRecruitee,
};

export const EXTRA_ADAPTERS: Record<string, Adapter> = { workable, smartrecruiters, recruitee };

export const EXTRA_SUPPORTED_HINT =
  "Supported: Greenhouse (job-boards.greenhouse.io/…), Lever (jobs.lever.co/…), Ashby (jobs.ashbyhq.com/…), Workable (apply.workable.com/…), SmartRecruiters (jobs.smartrecruiters.com/…) and Recruitee (….recruitee.com/o/…) job links.";
