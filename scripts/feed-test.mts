// Dev helper: run the job-discovery feed once against live public APIs. No database, no applications.
// Usage: npx tsx --conditions=react-server scripts/feed-test.mts
//   FEED_DISCOVERY=0  skip the aggregators (Remotive asks for at most ~4 calls/day)
//   FEED_SOURCES=workable,workday  only query these ATSes' seed boards
import { ATS_SOURCES, collectJobs, SEED_COMPANIES } from "@/lib/feed";
import type { AtsSource, CompanyList, FeedPreferences, ScoredListing } from "@/lib/feed/types";

const prefs: FeedPreferences = {
  titles: ["Software Engineer", "Backend Engineer"],
  locations: ["Dubai", "United Arab Emirates", "Saudi Arabia", "United Kingdom", "Remote"],
  remoteOk: true,
  onsiteOk: true,
  excludeCompanies: [],
  excludeKeywords: ["intern"],
  maxAgeDays: 30,
};

// Clearly fake sample background, only used for keyword overlap scoring.
const profileText =
  "Backend software engineer, 6 years. TypeScript, Node, Python, Go. Postgres, Redis, Kafka, AWS, Kubernetes, Docker, " +
  "Terraform. Built distributed payments APIs, GraphQL and REST services, observability with Datadog and Prometheus.";

const only = process.env.FEED_SOURCES?.split(",").map((s) => s.trim()) as AtsSource[] | undefined;
const companies = only
  ? (Object.fromEntries(ATS_SOURCES.map((s) => [s, only.includes(s) ? SEED_COMPANIES[s] : []])) as CompanyList)
  : undefined;

const { listings, stats, newCompanies } = await collectJobs(prefs, {
  profileText,
  companies,
  discovery: process.env.FEED_DISCOVERY !== "0",
});

const line = (l: ScoredListing) =>
  `[${l.score}] ${l.title} — ${l.company} (${l.source}${l.autoApply ? "" : ", manual apply"}) · ${l.location || "?"}${l.remote ? " · remote" : ""}`;

console.log(`\nBoards queried: ${stats.boardsQueried}`);
console.log(`Listings per ATS (deduped, total ${stats.totalFetched}):`);
const matchedBy = (s: AtsSource) => listings.filter((l) => l.source === s).length;
for (const s of ATS_SOURCES) {
  const boards = (companies ?? SEED_COMPANIES)[s].length;
  const failed = stats.failures.filter((f) => f.source === s).length;
  console.log(`  ${s.padEnd(16)} ${String(stats.perSource[s]).padStart(6)} jobs  ${String(matchedBy(s)).padStart(4)} matched  ${boards} boards, ${failed} failed`);
}
console.log("Aggregators:", stats.perAggregator);
console.log(`Failures (${stats.failures.length}):`);
for (const f of stats.failures) console.log(`  ${f.source}:${f.board} — ${f.error}`);
console.log(`New companies discovered (${newCompanies.length}):`);
for (const c of newCompanies) console.log(`  ${c.source}:${c.board} (${c.company}) via ${c.via}`);
console.log(`\nAfter filtering: ${stats.afterFilter} (${listings.filter((l) => l.autoApply).length} auto-apply)`);
const buckets = [90, 80, 70, 60, 0].map((min, i, all) => {
  const max = i ? all[i - 1] : 101;
  return `${min}+: ${listings.filter((l) => l.score >= min && l.score < max).length}`;
});
console.log(`Score distribution: ${buckets.join(", ")}`);

console.log(`\nTop 15:`);
for (const l of listings.slice(0, 15)) {
  console.log(`\n${line(l)}`);
  console.log(`  posted ${l.postedAt?.slice(0, 10) ?? "?"} · via ${l.discoveredVia}`);
  console.log(`  ${l.reasons.join(" | ")}`);
  console.log(`  ${l.applyUrl}`);
}

console.log(`\nTop 3 per ATS:`);
for (const s of ATS_SOURCES) {
  const top = listings.filter((l) => l.source === s).slice(0, 3);
  if (!top.length) continue;
  console.log(`\n  ${s}:`);
  for (const l of top) console.log(`    ${line(l)}\n      ${l.applyUrl}`);
}
console.log(`\nElapsed: ${(stats.elapsedMs / 1000).toFixed(1)}s`);
