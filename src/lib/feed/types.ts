// Job-discovery feed: ATS-neutral listings and the user's search preferences.

export const ATS_SOURCES = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "recruitee",
  "personio",
  "workday",
] as const;

export type AtsSource = (typeof ATS_SOURCES)[number];

/** ATSes whose application form our fillers can submit; Personio and Workday listings need a manual apply. */
export const AUTO_APPLY: Record<AtsSource, boolean> = {
  greenhouse: true,
  lever: true,
  ashby: true,
  workable: true,
  smartrecruiters: true,
  recruitee: true,
  personio: false,
  workday: false,
};

export type JobListing = {
  source: AtsSource;
  // Greenhouse board token / Lever company / Ashby org / Workable account / SmartRecruiters company id /
  // Recruitee subdomain / Personio subdomain (or full *.jobs.personio.com host) / Workday "tenant|wdN|site"
  board: string;
  externalId: string;
  url: string; // public posting page
  applyUrl: string; // application form our fillers understand
  title: string;
  company: string;
  location: string;
  remote: boolean;
  postedAt: string | null; // ISO timestamp when the ATS exposes it
  description: string; // plain text, truncated to ~8k chars
  discoveredVia: string; // "seed" or the aggregator that led us to the board
  autoApply: boolean; // AUTO_APPLY[source]: false means the user applies on the ATS page themselves
};

export type FeedPreferences = {
  titles: string[]; // target job titles / keywords
  locations: string[]; // cities / countries
  remoteOk: boolean;
  onsiteOk: boolean;
  excludeCompanies: string[];
  excludeKeywords: string[]; // e.g. "senior staff", "intern"
  maxAgeDays: number;
};

// Boards per ATS. Sources missing from older lists (e.g. saved before an ATS was added) count as empty.
export type CompanyList = Record<AtsSource, string[]>;

export type ScoredListing = JobListing & { score: number; reasons: string[] };

export type BoardFailure = { source: AtsSource | string; board: string; error: string };

export type FeedStats = {
  elapsedMs: number;
  boardsQueried: number;
  perSource: Record<AtsSource, number>; // raw listings fetched per ATS
  perAggregator: Record<string, { fetched: number; atsLinks: number; resolved: number }>;
  failures: BoardFailure[];
  totalFetched: number; // after dedupe
  afterFilter: number;
};
