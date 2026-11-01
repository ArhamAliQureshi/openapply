import type { FeedPreferences, JobListing } from "./types";

// Deterministic filtering and scoring of listings against the user's preferences. No LLM calls.

// ---------- normalization ----------

const PHRASES: [RegExp, string][] = [
  [/\bfront[\s-]+end\b/g, "frontend"],
  [/\bback[\s-]+end\b/g, "backend"],
  [/\bfull[\s-]+stack\b/g, "fullstack"],
  [/\bdev[\s-]+ops\b/g, "devops"],
  [/\bsite reliability\b/g, "sre"],
  [/\bmachine learning\b/g, "ml"],
  [/\bartificial intelligence\b/g, "ai"],
  [/\bc\+\+/g, "cpp"],
  [/\bc#/g, "csharp"],
  [/\.net\b/g, "dotnet"],
  [/\bnode\.?js\b/g, "node"],
  [/\bsr\.?(?=\s)/g, "senior"],
  [/\bjr\.?(?=\s)/g, "junior"],
  [/&/g, " and "],
];

// Words that mean the same thing in a job title.
const WORD_SYNONYMS: Record<string, string> = {
  developer: "engineer",
  programmer: "engineer",
  dev: "engineer",
  engineers: "engineer",
  swe: "software engineer",
  sde: "software engineer",
  mle: "ml engineer",
};

function normalize(s: string): string {
  let out = ` ${s.toLowerCase()} `;
  for (const [re, rep] of PHRASES) out = out.replace(re, rep);
  return out.replace(/[^a-z0-9+#]+/g, " ").trim();
}

const titleWords = (s: string) =>
  normalize(s)
    .split(" ")
    .flatMap((w) => (WORD_SYNONYMS[w] ?? w).split(" "))
    .filter(Boolean);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasPhrase = (haystack: string, phrase: string) =>
  phrase.length > 0 && new RegExp(`(^| )${escapeRe(phrase)}( |$)`).test(haystack);

// ---------- title ----------

// Seniority / level words ignored when deciding whether a title is exactly the target.
const LEVEL = new Set("senior staff principal lead junior mid entry level i ii iii iv v 1 2 3 4".split(" "));

/** Minimum titleSimilarity for a listing to count as matching a target title. */
export const TITLE_MATCH = 0.8;

/**
 * 1 = same title apart from seniority ("Senior Software Engineer II" vs "Software Engineer"),
 * 0.9 = target phrase appears in order, 0.8 = all target words present, else partial overlap (0–0.5).
 */
export function titleSimilarity(title: string, target: string): number {
  const t = titleWords(title.replace(/\([^)]*\)/g, " "));
  const want = titleWords(target);
  if (!want.length || !t.length) return 0;
  const core = t.filter((w) => !LEVEL.has(w)).join(" ");
  const wantCore = want.filter((w) => !LEVEL.has(w)).join(" ");
  if (core === wantCore) return 1;
  if (hasPhrase(t.join(" "), want.join(" "))) return 0.9;
  const set = new Set(t);
  const hit = want.filter((w) => set.has(w)).length;
  if (hit === want.length) return 0.8;
  return 0.5 * (hit / want.length);
}

const bestTitle = (title: string, targets: string[]) =>
  targets.reduce((best, target) => {
    const s = titleSimilarity(title, target);
    return s > best.score ? { score: s, target } : best;
  }, { score: 0, target: "" });

// ---------- location ----------

const US_STATES =
  "al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc".split(" ");
const US_STATE_NAMES =
  "alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming".split("|");

// A preferred location also matches these spellings / places inside it. Two-letter country codes that
// collide with US state codes (CA, DE, IN, ...) are left out on purpose.
const LOCATION_ALIASES: Record<string, string[]> = {
  "united states": ["us", "usa", "u s", "u s a", "america", "americas", "north america", "nyc", "sf", "bay area", ...US_STATE_NAMES],
  "united kingdom": ["uk", "gb", "great britain", "england", "scotland", "wales", "london", "manchester", "edinburgh", "bristol", "cambridge uk"],
  "united arab emirates": ["uae", "dubai", "abu dhabi", "sharjah"],
  "saudi arabia": ["ksa", "riyadh", "jeddah", "dammam"],
  germany: ["deutschland", "berlin", "munich", "munchen", "hamburg", "frankfurt", "cologne", "koln"],
  netherlands: ["nl", "amsterdam", "rotterdam", "utrecht", "the hague"],
  france: ["paris", "lyon"],
  spain: ["madrid", "barcelona"],
  ireland: ["dublin"],
  canada: ["toronto", "vancouver", "montreal"],
  india: ["bangalore", "bengaluru", "hyderabad", "pune", "mumbai", "delhi", "gurgaon", "gurugram"],
  pakistan: ["karachi", "lahore", "islamabad"],
  europe: ["eu", "emea", "european union"],
  "san francisco": ["sf", "bay area", "san francisco bay area"],
  "new york": ["nyc", "new york city"],
};

function locationTerms(pref: string): string[] {
  const p = normalize(pref);
  return [p, ...(LOCATION_ALIASES[p] ?? [])];
}

/** Does the listing's location text name one of the preferred places? Returns the matched preference. */
export function matchLocation(location: string, prefs: string[]): string | null {
  const loc = normalize(location);
  // Raw text keeps the case of state codes ("Austin, TX") so "in"/"or"/"me" don't match prose.
  const stateCodes = [...location.matchAll(/,\s*([A-Z]{2})\b/g)].map((m) => m[1].toLowerCase());
  for (const pref of prefs) {
    const p = normalize(pref);
    if (!p || p === "remote") continue;
    if (locationTerms(pref).some((term) => hasPhrase(loc, term))) return pref;
    if (p === "united states" && stateCodes.some((c) => US_STATES.includes(c))) return pref;
  }
  return null;
}

// Remote roles restricted to a region the user did not ask for score lower.
const REGION_WORDS = /\b(us|usa|united states|canada|uk|united kingdom|europe|eu|emea|apac|latam|germany|india|americas|north america|asia)\b/;

// ---------- filtering ----------

const ageDays = (iso: string) => (Date.now() - new Date(iso).getTime()) / 86_400_000;

export function filterListings(listings: JobListing[], prefs: FeedPreferences): JobListing[] {
  const excludedCompanies = new Set(prefs.excludeCompanies.map((c) => normalize(c).replace(/ /g, "")).filter(Boolean));
  const excludedWords = prefs.excludeKeywords.map(normalize).filter(Boolean);
  const titles = prefs.titles.filter((t) => t.trim());
  const wantsRemoteByName = prefs.locations.some((l) => normalize(l) === "remote");

  return listings.filter((l) => {
    if (titles.length && !titles.some((t) => titleSimilarity(l.title, t) >= TITLE_MATCH)) return false;

    const title = normalize(l.title);
    // Keywords are checked against the title only: descriptions routinely say "internal", "interns", etc.
    if (excludedWords.some((w) => hasPhrase(title, w))) return false;
    if (excludedCompanies.has(normalize(l.company).replace(/ /g, "")) || excludedCompanies.has(normalize(l.board).replace(/ /g, ""))) {
      return false;
    }
    if (l.postedAt && prefs.maxAgeDays > 0 && ageDays(l.postedAt) > prefs.maxAgeDays) return false;

    const placeMatch = matchLocation(l.location, prefs.locations) !== null;
    if (l.remote && (prefs.remoteOk || wantsRemoteByName)) return true;
    if (prefs.onsiteOk && placeMatch) return true;
    return !prefs.locations.length && prefs.onsiteOk; // no location preference: anywhere on-site
  });
}

// ---------- scoring ----------

// Skills worth comparing between a job description and a profile. Single tokens after normalize().
// Words that are also ordinary English ("go", "rest", "next", "express", "spring") are left out.
const SKILLS = new Set(
  (
    "typescript javascript python java kotlin scala golang rust ruby rails php elixir erlang haskell clojure cpp csharp dotnet " +
    "react nextjs vue angular svelte redux tailwind graphql grpc node nestjs django flask fastapi laravel " +
    "postgres postgresql mysql sqlite mongodb redis cassandra dynamodb elasticsearch kafka rabbitmq sqs pubsub spark flink airflow dbt snowflake bigquery redshift clickhouse " +
    "aws gcp azure kubernetes docker terraform pulumi ansible helm linux serverless cloudflare " +
    "ml llm llms pytorch tensorflow jax nlp rag embeddings cuda " +
    "microservices payments fintech observability prometheus grafana datadog devops sre " +
    "ios android flutter sql nosql etl websockets webrtc"
  ).split(/\s+/),
);

const STOP = new Set(
  "the and for with you our are will your have this that from who what about work team teams role able more into their they them can all not but its also such using use well across new strong including experience years year ability skills".split(
    " ",
  ),
);

const skillSet = (text: string) => new Set(normalize(text).split(" ").filter((w) => SKILLS.has(w)));
const wordSet = (text: string) => new Set(normalize(text).split(" ").filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)));

/**
 * 0–100: title similarity (up to 50), location fit (up to 25), skill/keyword overlap with the profile (up to 25).
 */
export function scoreListing(
  listing: JobListing,
  prefs: FeedPreferences,
  profileText: string,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];

  const title = bestTitle(listing.title, prefs.titles);
  const titlePts = Math.round(title.score * 50);
  if (title.score === 1) reasons.push(`Title is "${title.target}"`);
  else if (title.score >= 0.9) reasons.push(`Title contains "${title.target}"`);
  else if (title.score >= TITLE_MATCH) reasons.push(`Title has all words of "${title.target}"`);
  else if (title.score > 0) reasons.push(`Title partly matches "${title.target}"`);

  let locPts = 0;
  const place = matchLocation(listing.location, prefs.locations);
  if (listing.remote && prefs.remoteOk) {
    const region = normalize(listing.location).match(REGION_WORDS);
    if (place) {
      locPts = 25;
      reasons.push(`Remote, open to ${place}`);
    } else if (!region) {
      locPts = 22;
      reasons.push("Remote");
    } else {
      locPts = 10;
      reasons.push(`Remote but limited to ${listing.location}`);
    }
  } else if (place) {
    locPts = prefs.onsiteOk ? 25 : 12;
    reasons.push(`Located in ${place}`);
  }

  let kwPts = 0;
  if (profileText.trim()) {
    const jobSkills = skillSet(`${listing.title}\n${listing.description}`);
    const mine = skillSet(profileText);
    if (jobSkills.size >= 3) {
      const shared = [...jobSkills].filter((s) => mine.has(s));
      // Fraction of the job's named skills you have, capped so very long skill lists don't dilute it.
      kwPts = Math.round(25 * Math.min(1, shared.length / Math.min(jobSkills.size, 12)));
      if (shared.length) reasons.push(`Skills overlap: ${shared.slice(0, 8).join(", ")}`);
    } else {
      const jobWords = wordSet(listing.description);
      const myWords = wordSet(profileText);
      const shared = [...myWords].filter((w) => jobWords.has(w));
      kwPts = Math.round(25 * Math.min(1, shared.length / 20));
      if (shared.length) reasons.push(`${shared.length} shared keywords`);
    }
  }

  return { score: Math.max(0, Math.min(100, titlePts + locPts + kwPts)), reasons };
}
