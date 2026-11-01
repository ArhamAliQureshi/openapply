import "server-only";
import seed from "./companies.json";
import { filterListings, scoreListing, TITLE_MATCH, titleSimilarity } from "./match";
import {
  collectBoards,
  dedupe,
  fetchArbeitnow,
  fetchMuse,
  fetchRemotive,
  resolveHits,
  type AggregatorHit,
  type DiscoveredCompany,
} from "./sources";
import { ATS_SOURCES, type AtsSource, type CompanyList, type FeedPreferences, type FeedStats, type JobListing, type ScoredListing } from "./types";

export type { DiscoveredCompany } from "./sources";
export type * from "./types";
export { ATS_SOURCES } from "./types";

export const SEED_COMPANIES: CompanyList = seed;

export type CollectOptions = {
  companies?: Partial<CompanyList>; // defaults to the seed list
  extraCompanies?: Partial<CompanyList>; // e.g. boards discovered on earlier runs
  discovery?: boolean; // query aggregators for new boards (default true)
  aggregators?: ("remotive" | "arbeitnow" | "themuse")[];
  museCategories?: string[];
  maxProbeCompanies?: number; // unknown aggregator companies to probe per run (default 40)
  profileText?: string; // resume / about-me text for keyword scoring
};

// `a` may be a list saved before some ATSes existed, so every source is optional on both sides.
const merge = (a: Partial<CompanyList>, b: Partial<CompanyList> = {}): CompanyList =>
  Object.fromEntries(ATS_SOURCES.map((s) => [s, [...new Set([...(a[s] ?? []), ...(b[s] ?? [])])]])) as CompanyList;

/** Collects open jobs from known boards (+ aggregator-discovered ones), filters to prefs, scores and sorts them. */
export async function collectJobs(
  prefs: FeedPreferences,
  opts: CollectOptions = {},
): Promise<{ listings: ScoredListing[]; stats: FeedStats; newCompanies: DiscoveredCompany[] }> {
  const started = Date.now();
  const companies = merge(opts.companies ?? SEED_COMPANIES, opts.extraCompanies);
  const aggregators = opts.discovery === false ? [] : (opts.aggregators ?? ["remotive", "arbeitnow", "themuse"]);
  const perAggregator: FeedStats["perAggregator"] = {};
  const aggFailures: FeedStats["failures"] = [];

  const loadHits = async (): Promise<AggregatorHit[]> => {
    const runs = aggregators.map(async (name) => {
      try {
        const hits =
          name === "remotive"
            ? await fetchRemotive()
            : name === "arbeitnow"
              ? await fetchArbeitnow()
              : await fetchMuse(opts.museCategories ?? ["Software Engineering", "Data and Analytics"]);
        perAggregator[name] = { fetched: hits.length, atsLinks: 0, resolved: 0 };
        return hits;
      } catch (e) {
        perAggregator[name] = { fetched: 0, atsLinks: 0, resolved: 0 };
        aggFailures.push({ source: name, board: "-", error: e instanceof Error ? e.message : String(e) });
        return [];
      }
    });
    return (await Promise.all(runs)).flat();
  };

  // Big SmartRecruiters/Workday boards are searched for the target titles, and only title-matching
  // postings get a (description) detail request.
  const wantTitle = (title: string) => prefs.titles.some((t) => titleSimilarity(title, t) >= TITLE_MATCH);
  const ctx = { searchTerms: prefs.titles.filter((t) => t.trim()), wantTitle };

  // Seed boards and aggregators run concurrently (different hosts).
  const [boards, hits] = await Promise.all([collectBoards(companies, ctx), loadHits()]);

  const discovered = hits.length
    ? await resolveHits(hits, companies, {
        maxProbeCompanies: opts.maxProbeCompanies ?? 40,
        // Probe companies advertising a role we want before anyone else.
        prioritize: (h) => wantTitle(h.title),
        ctx,
      })
    : { listings: [], newCompanies: [], failures: [], perVia: {} };
  for (const [via, v] of Object.entries(discovered.perVia)) {
    const agg = (perAggregator[via] ??= { fetched: 0, atsLinks: 0, resolved: 0 });
    agg.atsLinks = v.atsLinks;
    agg.resolved = v.resolved;
  }

  const all: JobListing[] = dedupe([...boards.listings, ...discovered.listings]);
  const perSource = Object.fromEntries(ATS_SOURCES.map((s) => [s, 0])) as Record<AtsSource, number>;
  for (const l of all) perSource[l.source]++;

  const profileText = opts.profileText ?? "";
  const listings = filterListings(all, prefs)
    .map((l) => ({ ...l, ...scoreListing(l, prefs, profileText) }))
    .sort((a, b) => b.score - a.score || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));

  return {
    listings,
    newCompanies: discovered.newCompanies,
    stats: {
      elapsedMs: Date.now() - started,
      boardsQueried: boards.boards,
      perSource,
      perAggregator,
      failures: [...boards.failures, ...aggFailures, ...discovered.failures],
      totalFetched: all.length,
      afterFilter: listings.length,
    },
  };
}
