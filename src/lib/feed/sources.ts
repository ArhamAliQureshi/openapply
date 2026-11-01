import "server-only";
import { greenhouseApplyUrl, parseGreenhouseUrl } from "@/lib/ats/greenhouse";
import { errorText, FetchError, getJson } from "./http";
import {
  fetchPersonioBoard,
  fetchRecruiteeBoard,
  fetchSmartRecruitersBoard,
  fetchWorkableBoard,
  fetchWorkdayBoard,
  type FetchContext,
} from "./more-sources";
import { clip, decodeEntities, htmlToText, isRemoteText, prettyBoard, toIso } from "./text";
import { ATS_SOURCES, AUTO_APPLY, type AtsSource, type BoardFailure, type CompanyList, type JobListing } from "./types";

// Read-only collectors over public job-board APIs: Greenhouse, Lever and Ashby here; Workable, SmartRecruiters,
// Recruitee, Personio and Workday in ./more-sources. Free aggregator APIs are used only to discover more boards.


// ---------- Greenhouse ----------

type GhListJob = {
  id: number;
  title: string;
  company_name?: string;
  absolute_url: string;
  content?: string;
  location?: { name: string } | null;
  updated_at?: string;
  first_published?: string | null;
};

async function fetchGreenhouseBoard(token: string, via = "seed"): Promise<JobListing[]> {
  const data = await getJson<{ jobs: GhListJob[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
  );
  return (data.jobs ?? []).map((j) => {
    const location = j.location?.name?.trim() ?? "";
    return {
      source: "greenhouse",
      board: token,
      externalId: String(j.id),
      url: j.absolute_url,
      applyUrl: greenhouseApplyUrl(token, String(j.id)),
      title: j.title.trim(),
      company: j.company_name?.trim() || prettyBoard(token),
      location,
      remote: isRemoteText(location) || /\bremote\b/i.test(j.title),
      postedAt: toIso(j.first_published ?? j.updated_at),
      // Greenhouse returns HTML-escaped HTML: decode once, then strip tags.
      description: clip(htmlToText(decodeEntities(j.content ?? ""))),
      discoveredVia: via,
      autoApply: AUTO_APPLY.greenhouse,
    };
  });
}

// ---------- Lever ----------

type LeverPosting = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl: string;
  createdAt?: number;
  country?: string | null;
  workplaceType?: string; // "remote" | "hybrid" | "on-site" | "unspecified"
  categories?: { location?: string; allLocations?: string[]; commitment?: string; team?: string };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
};

async function fetchLeverBoard(company: string, via = "seed"): Promise<JobListing[]> {
  const data = await getJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`);
  if (!Array.isArray(data)) return [];
  return data.map((p) => {
    const locs = p.categories?.allLocations?.length ? p.categories.allLocations : [p.categories?.location ?? ""];
    let location = locs.filter(Boolean).join("; ");
    if (p.country && !new RegExp(`\\b${p.country}\\b`).test(location)) location = `${location} (${p.country})`.trim();
    const description = [
      p.descriptionPlain ?? "",
      ...(p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`),
      p.additionalPlain ?? "",
    ].join("\n\n");
    return {
      source: "lever",
      board: company,
      externalId: p.id,
      url: p.hostedUrl,
      applyUrl: p.applyUrl || `${p.hostedUrl}/apply`,
      title: p.text.trim(),
      company: prettyBoard(company),
      location,
      remote: p.workplaceType === "remote" || isRemoteText(location),
      postedAt: toIso(p.createdAt),
      description: clip(description.trim()),
      discoveredVia: via,
      autoApply: AUTO_APPLY.lever,
    };
  });
}

// ---------- Ashby ----------

type AshbyJob = {
  id: string;
  title: string;
  location?: string;
  secondaryLocations?: { location?: string }[];
  isRemote?: boolean;
  isListed?: boolean;
  workplaceType?: string | null; // "Remote" | "Hybrid" | "OnSite"
  publishedAt?: string;
  jobUrl: string;
  applyUrl?: string;
  descriptionPlain?: string;
  compensation?: { compensationTierSummary?: string | null } | null;
};

async function fetchAshbyBoard(org: string, via = "seed"): Promise<JobListing[]> {
  const data = await getJson<{ jobs: AshbyJob[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`,
  );
  return (data.jobs ?? [])
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const location = [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean).join("; ");
      const comp = j.compensation?.compensationTierSummary;
      return {
        source: "ashby",
        board: org,
        externalId: j.id,
        url: j.jobUrl,
        applyUrl: j.applyUrl || `${j.jobUrl}/application`,
        title: j.title.trim(),
        company: prettyBoard(org),
        location,
        remote: Boolean(j.isRemote) || j.workplaceType === "Remote" || isRemoteText(location),
        postedAt: toIso(j.publishedAt),
        description: clip(((comp ? `Compensation: ${comp}\n\n` : "") + (j.descriptionPlain ?? "")).trim()),
        discoveredVia: via,
        autoApply: AUTO_APPLY.ashby,
      };
    });
}

type Fetcher = (board: string, via?: string, ctx?: FetchContext) => Promise<JobListing[]>;

const FETCHERS: Record<AtsSource, Fetcher> = {
  greenhouse: fetchGreenhouseBoard,
  lever: fetchLeverBoard,
  ashby: fetchAshbyBoard,
  workable: fetchWorkableBoard,
  smartrecruiters: fetchSmartRecruitersBoard,
  recruitee: fetchRecruiteeBoard,
  personio: fetchPersonioBoard,
  workday: fetchWorkdayBoard,
};

/** Fetches every board; a failing board is recorded and skipped. */
export async function collectBoards(
  companies: Partial<CompanyList>,
  ctx: FetchContext = {},
): Promise<{ listings: JobListing[]; failures: BoardFailure[]; boards: number }> {
  const tasks = ATS_SOURCES.flatMap((source) => [...new Set(companies[source] ?? [])].map((board) => ({ source, board })));
  const failures: BoardFailure[] = [];
  const results = await Promise.all(
    tasks.map(async ({ source, board }) => {
      try {
        return await FETCHERS[source](board, "seed", ctx);
      } catch (e) {
        failures.push({ source, board, error: errorText(e) });
        return [];
      }
    }),
  );
  return { listings: results.flat(), failures, boards: tasks.length };
}

// ---------- discovery aggregators ----------

/** A job seen on an aggregator. Only used to find the company's Greenhouse/Lever/Ashby board. */
export type AggregatorHit = { via: string; company: string; title: string; url: string; location: string; text: string };

type RemotiveJob = { url: string; title: string; company_name: string; candidate_required_location?: string; description?: string };
type ArbeitnowJob = { url: string; title: string; company_name: string; location?: string; description?: string };
type MuseJob = {
  name: string;
  contents?: string;
  company: { name: string };
  locations?: { name: string }[];
  refs?: { landing_page?: string };
};

/** Remotive's free API returns a small, 24h-delayed sample; its ToS asks for at most ~4 calls/day. */
export async function fetchRemotive(): Promise<AggregatorHit[]> {
  const data = await getJson<{ jobs: RemotiveJob[] }>("https://remotive.com/api/remote-jobs");
  return (data.jobs ?? []).map((j) => ({
    via: "remotive",
    company: j.company_name.trim(),
    title: j.title,
    url: j.url,
    location: j.candidate_required_location ?? "Remote",
    text: j.description ?? "",
  }));
}

/** Arbeitnow: 300 jobs per page, mostly Germany/EU, ordered by newest. */
export async function fetchArbeitnow(pages = 2): Promise<AggregatorHit[]> {
  const out: AggregatorHit[] = [];
  for (let page = 1; page <= pages; page++) {
    const data = await getJson<{ data: ArbeitnowJob[]; links?: { next?: string | null } }>(
      `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
    );
    for (const j of data.data ?? []) {
      out.push({ via: "arbeitnow", company: j.company_name.trim(), title: j.title, url: j.url, location: j.location ?? "", text: j.description ?? "" });
    }
    if (!data.links?.next) break;
  }
  return out;
}

/** The Muse public API (no key: ~500 requests/hour). 20 jobs per page. */
export async function fetchMuse(categories: string[], pages = 2): Promise<AggregatorHit[]> {
  const out: AggregatorHit[] = [];
  for (const category of categories) {
    for (let page = 0; page < pages; page++) {
      const data = await getJson<{ results: MuseJob[]; page_count?: number }>(
        `https://www.themuse.com/api/public/jobs?page=${page}&category=${encodeURIComponent(category)}`,
      );
      for (const j of data.results ?? []) {
        out.push({
          via: "themuse",
          company: j.company.name.trim(),
          title: j.name,
          url: j.refs?.landing_page ?? "",
          location: (j.locations ?? []).map((l) => l.name).join("; "),
          text: j.contents ?? "",
        });
      }
      if (data.page_count !== undefined && page + 1 >= data.page_count) break;
    }
  }
  return out;
}

// ---------- resolving aggregator hits to ATS boards ----------

type AtsRef = { source: AtsSource; board: string; jobId?: string };

/** Finds links to any supported ATS board (and company-site ?gh_jid= links) in a URL or description. */
function extractAtsLinks(text: string): { refs: AtsRef[]; ghJobIds: string[] } {
  const refs: AtsRef[] = [];
  const ghJobIds: string[] = [];
  const decoded = decodeEntities(text);
  for (const m of decoded.matchAll(/https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/[^\s"'<>)\]]+/gi)) {
    const gh = parseGreenhouseUrl(m[0]);
    if (gh) refs.push({ source: "greenhouse", board: gh.board.toLowerCase(), jobId: gh.jobId });
    else {
      const board = m[0].match(/greenhouse\.io\/([a-z0-9_-]+)\/?$/i)?.[1];
      if (board && board !== "embed") refs.push({ source: "greenhouse", board: board.toLowerCase() });
    }
  }
  for (const m of decoded.matchAll(/https?:\/\/jobs\.lever\.co\/([a-z0-9._-]+)(?:\/([0-9a-f-]{36}))?/gi)) {
    refs.push({ source: "lever", board: m[1].toLowerCase(), jobId: m[2] });
  }
  for (const m of decoded.matchAll(/https?:\/\/jobs\.ashbyhq\.com\/([^/\s"'<>?#)]+)(?:\/([0-9a-f-]{36}))?/gi)) {
    refs.push({ source: "ashby", board: decodeURIComponent(m[1]), jobId: m[2] });
  }
  for (const m of decoded.matchAll(/https?:\/\/apply\.workable\.com\/(?!api\/|j\/)([a-z0-9-]+)(?:\/j\/([0-9A-F]{6,}))?/gi)) {
    refs.push({ source: "workable", board: m[1].toLowerCase(), jobId: m[2] });
  }
  for (const m of decoded.matchAll(/https?:\/\/(?!apply\.|www\.|help\.|resources\.)([a-z0-9-]+)\.workable\.com\b/gi)) {
    refs.push({ source: "workable", board: m[1].toLowerCase() });
  }
  for (const m of decoded.matchAll(/https?:\/\/(?:jobs|careers)\.smartrecruiters\.com\/(?!oneclick|external-referrals|sr-jobs)([A-Za-z0-9_-]+)(?:\/(\d{6,}))?/g)) {
    refs.push({ source: "smartrecruiters", board: m[1], jobId: m[2] });
  }
  for (const m of decoded.matchAll(/https?:\/\/(?!app\.|www\.|api\.|support\.)([a-z0-9-]+)\.recruitee\.com\b/gi)) {
    refs.push({ source: "recruitee", board: m[1].toLowerCase() });
  }
  for (const m of decoded.matchAll(/https?:\/\/([a-z0-9-]+)\.jobs\.personio\.(de|com)\b(?:\/job\/(\d+))?/gi)) {
    const slug = m[1].toLowerCase();
    refs.push({ source: "personio", board: m[2].toLowerCase() === "de" ? slug : `${slug}.jobs.personio.com`, jobId: m[3] });
  }
  for (const m of decoded.matchAll(/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?(?!wday\/)([A-Za-z0-9_-]+)/g)) {
    refs.push({ source: "workday", board: `${m[1].toLowerCase()}|${m[2].toLowerCase()}|${m[3]}` });
  }
  for (const m of decoded.matchAll(/https?:\/\/(?![^/\s]*greenhouse\.io)[^\s"'<>]+[?&]gh_jid=(\d+)/gi)) ghJobIds.push(m[1]);
  return { refs, ghJobIds };
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const LEGAL_SUFFIX =
  /\b(gmbh|ag|se|inc|llc|ltd|limited|plc|corp|corporation|co|company|b\.?v|s\.?a|sas|sarl|oy|ab|as|kg|ug|group|holdings?|technologies|technology|labs|hq)\b\.?/gi;

/** Plausible board tokens for a company name: "Quantum-Systems GmbH" → ["quantumsystems", "quantum-systems"]. */
function slugCandidates(company: string): string[] {
  const base = company
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(LEGAL_SUFFIX, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!base) return [];
  return [...new Set([base.replace(/[\s-]/g, ""), base.replace(/\s+/g, "-")])].filter((s) => s.length >= 2);
}

const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // "(m/w/d)", "(all genders)"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** True when the board really belongs to the aggregator's company: same job title, or same Greenhouse company name. */
function confirms(listings: JobListing[], hit: AggregatorHit): boolean {
  const want = normTitle(hit.title);
  const company = normName(hit.company);
  return listings.some((l) => {
    const t = normTitle(l.title);
    if (t && want && (t === want || (want.length > 12 && (t.includes(want) || want.includes(t))))) return true;
    return l.source === "greenhouse" && normName(l.company) === company && company.length > 2;
  });
}

export type DiscoveredCompany = { source: AtsSource; board: string; company: string; via: string };

/**
 * Turns aggregator hits into ATS listings: follows direct ATS links, resolves ?gh_jid= links,
 * and probes the Ashby/Greenhouse/Lever public APIs with slugs of unknown company names (confirmed by a matching job).
 */
export async function resolveHits(
  hits: AggregatorHit[],
  known: CompanyList,
  opts: { maxProbeCompanies: number; prioritize?: (hit: AggregatorHit) => boolean; ctx?: FetchContext },
): Promise<{
  listings: JobListing[];
  newCompanies: DiscoveredCompany[];
  failures: BoardFailure[];
  perVia: Record<string, { atsLinks: number; resolved: number }>;
}> {
  const knownKeys = new Set((Object.keys(known) as AtsSource[]).flatMap((s) => (known[s] ?? []).map((b) => `${s}:${b.toLowerCase()}`)));
  const knownNames = new Set(Object.values(known).flat().map(normName));
  const listings: JobListing[] = [];
  const newCompanies: DiscoveredCompany[] = [];
  const failures: BoardFailure[] = [];
  const perVia: Record<string, { atsLinks: number; resolved: number }> = {};
  const tally = (via: string) => (perVia[via] ??= { atsLinks: 0, resolved: 0 });

  const adopt = (source: AtsSource, board: string, found: JobListing[], hit: AggregatorHit) => {
    const key = `${source}:${board.toLowerCase()}`;
    if (knownKeys.has(key)) return;
    knownKeys.add(key);
    knownNames.add(normName(board));
    listings.push(...found);
    newCompanies.push({ source, board, company: found[0]?.company ?? hit.company, via: hit.via });
    tally(hit.via).resolved++;
  };

  // 1. Direct ATS links in the aggregator's URL or description.
  const direct = new Map<string, { ref: AtsRef; hit: AggregatorHit }>();
  const ghjid: { hit: AggregatorHit; jobId: string }[] = [];
  for (const hit of hits) {
    const { refs, ghJobIds } = extractAtsLinks(`${hit.url}\n${hit.text}`);
    if (refs.length || ghJobIds.length) tally(hit.via).atsLinks += refs.length + ghJobIds.length;
    for (const ref of refs) {
      const key = `${ref.source}:${ref.board.toLowerCase()}`;
      if (!knownKeys.has(key) && !direct.has(key)) direct.set(key, { ref, hit });
    }
    for (const jobId of ghJobIds) ghjid.push({ hit, jobId });
  }
  await Promise.all(
    [...direct.values()].map(async ({ ref, hit }) => {
      try {
        const found = await FETCHERS[ref.source](ref.board, hit.via, opts.ctx);
        if (found.length) adopt(ref.source, ref.board, found, hit);
      } catch (e) {
        failures.push({ source: ref.source, board: ref.board, error: `${hit.via} link: ${errorText(e)}` });
      }
    }),
  );

  // 2. Company-site ?gh_jid= links: the job id is authoritative, so a slug that serves it is the board.
  await Promise.all(
    ghjid.map(async ({ hit, jobId }) => {
      for (const slug of slugCandidates(hit.company)) {
        if (knownKeys.has(`greenhouse:${slug}`)) return;
        try {
          await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${jobId}`);
          adopt("greenhouse", slug, await fetchGreenhouseBoard(slug, hit.via), hit);
          return;
        } catch {
          // try next slug
        }
      }
    }),
  );

  // 3. Probe ATS APIs with slugs of company names we have never seen.
  const byCompany = new Map<string, AggregatorHit>();
  const ordered = opts.prioritize ? [...hits.filter(opts.prioritize), ...hits.filter((h) => !opts.prioritize!(h))] : hits;
  for (const hit of ordered) {
    const n = normName(hit.company);
    if (n.length < 2 || knownNames.has(n) || byCompany.has(n)) continue;
    byCompany.set(n, hit);
  }
  const probe = [...byCompany.values()].slice(0, opts.maxProbeCompanies);
  await Promise.all(
    probe.map(async (hit) => {
      for (const slug of slugCandidates(hit.company)) {
        for (const source of ["ashby", "greenhouse", "lever"] as AtsSource[]) {
          if (knownKeys.has(`${source}:${slug}`)) return;
          try {
            const found = await FETCHERS[source](slug, hit.via);
            if (found.length && confirms(found, hit)) {
              adopt(source, slug, found, hit);
              return;
            }
          } catch (e) {
            // 404 is the normal "not on this ATS" answer; record anything else.
            if (!(e instanceof FetchError && e.status === 404)) {
              failures.push({ source, board: slug, error: `probe for ${hit.company}: ${errorText(e)}` });
            }
          }
        }
      }
    }),
  );

  return { listings, newCompanies, failures, perVia };
}

/** Keeps the first listing per (source, board, externalId). */
export function dedupe(listings: JobListing[]): JobListing[] {
  const seen = new Map<string, JobListing>();
  for (const l of listings) {
    const key = `${l.source}:${l.board.toLowerCase()}:${l.externalId}`;
    if (!seen.has(key)) seen.set(key, l);
  }
  return [...seen.values()];
}
