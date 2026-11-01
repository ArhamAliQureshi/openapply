// Builds src/lib/feed/yc-companies.json (+ .meta.json): job boards of Y Combinator–backed companies.
// Company names/batches come from general knowledge (no YC site / YC-derived dataset is fetched).
// Each board is verified on the ATS's own public read-only API: >=1 open job AND the company name matches.
// Run: npx tsx --conditions=react-server scripts/yc-probe.mts
import { readFileSync, writeFileSync } from "node:fs";

const UA = "ApplyKit/0.1 (personal job search)";
const TIMEOUT_MS = 15_000;
const HOST_CONCURRENCY = 4;
const COMPANY_CONCURRENCY = 16;

// "Name|batch|extra slugs (comma)|aliases (comma)". batch left empty when not known for sure.
const RAW = `
Reddit|S05||
Loopt|S05||
Justin.tv|W07|twitch|Twitch
Weebly|W07||
Songkick|W07||
Scribd|S06||
Xobni|S06||
Wufoo|W06||
Disqus|S07||
Dropbox|S07||
Heroku|W08||
Posterous|S08||
Airbnb|W09||
Stripe|S09||
Mixpanel|S09||
Bump|S09||
WePay|S09||
Heyzap|S09||
Optimizely|W10||
Docker|S10|docker,dotcloud|
PagerDuty|S10||
Zencoder|S10||
Homejoy|S10||
Hipmunk|S10||
Parse|S11||
HelloSign|W11|dropboxsign|Dropbox Sign
Mailgun|W11|mailgun,sinch|Sinch
Pebble|W11||
Segment|S11||
Codecademy|S11||
Sift|S11|sift,siftscience|Sift Science
Science Exchange|S11||
Vidyard|S11||
Clerky|S11||
Meteor|S11|apollographql,apollo|Apollo GraphQL,Apollo
GoCardless|S11||
Zapier|S12||
Instacart|S12||
Coinbase|S12||
Benchling|S12||
Amplitude|W12||
Gusto|W12|gusto,zenpayroll|
Clever|S12||
Brilliant|S12|brilliant,brilliantorg|Brilliant.org
Rainforest QA|S12|rainforestqa,rainforest|Rainforest
Swiftype|S12||
Strikingly|W12||
Rescale|W12||
LendUp|||Mission Lane
PlanGrid|W12||
Heap|W13|heap,heapanalytics|Heap
Fivetran|W13||
Zenefits|W13|zenefits|TriNet Zenefits
Wefunder|W13||
InfluxData|W13|influxdata,influxdb|InfluxData
Teespring|W13|teespring,spring|Spring
Watsi|W13||
Webflow|S13||
DoorDash|S13|doordash,doordashusa|DoorDash
Shippo|S13|shippo,goshippo|Shippo
Lob|S13|lob|Lob
EasyPost|S13||
Wyre|S13||
Snapdocs|S13||
DocSend|S13||
Panorama Education|S13|panoramaed,panorama|Panorama
GitLab|W15||
Algolia|W14||
Flexport|W14||
Cruise|W14|cruise,getcruise|Cruise
Bellabeat|||
Checkr|S14||
Ginkgo Bioworks|S14|ginkgobioworks,ginkgo|Ginkgo
Helion|S14|helionenergy,helion|Helion
Oklo|S14||
Rigetti|||
Atomwise|S14||
Sendwave|S14||
ShipBob|S14||
Front||front,frontapp|Front
Razorpay|W15||
Platzi|W15||
ReadMe|W15|readme|ReadMe
Fountain||fountain|Fountain
Mashgin|||
Paperspace|W15||
Notable Labs||notablelabs|Notable
Instawork|S15||
Ironclad|S15|ironcladhq,ironclad|Ironclad
Triplebyte|S15||
Zeplin|S15||
Primer|S15|primerai|Primer
Teleport|S15|teleport,gravitational|Teleport,Gravitational
Xendit|S15||
Chaldal|S15||
GrubMarket|||
Lugg|||
Rappi|W16||
Gecko Robotics|W16|geckorobotics,gecko|Gecko Robotics
Paystack|W16||
Truebill||rocketmoney,truebill|Rocket Money
Boom Supersonic|W16|boomsupersonic,boom|Boom
Astranis|W16||
Relativity Space|W16|relativityspace,relativity|Relativity Space
Embark Trucks|W16|embarktrucks,embark|Embark
Mux|W16|mux|Mux
Sendbird|W16||
Lattice|||
Podium|||
Outschool|||
Deepgram|W16||
Truepill|||
Scale AI|S16|scaleai|Scale
Meesho|S16||
Flutterwave|S16||
Starcity|||
Tovala|||
Stilt|||
Brex|W17||
Rippling|W17||
Retool|W17||
Faire|W17||
Clipboard Health|W17|clipboardhealth,clipboard|Clipboard Health
Speak||speak,usespeak|Speak
Zeus Living|||
Upsolve|W17||
Mercury|S17||
Pilot||pilot,pilothq|Pilot
AssemblyAI|S17||
Flock Safety|S17|flocksafety,flock|Flock Safety
Lambda School|S17|bloomtech,lambdaschool|BloomTech
Modern Fertility|S17||
Incredible Health|||
Groww|W18||
Chipper Cash|W18|chippercash,chipper|Chipper
OpenSea|W18||
Vanta|W18||
Replit|W18||
Momentus|W18||
Fintual|W18||
Shogun|||getshogun|Shogun
Census|||getcensus|Census
Treasury Prime||treasuryprime|Treasury Prime
OpenPhone||openphone,quo|OpenPhone,Quo
Payfazz|||
Modern Treasury|S18||
Unit21|S18||
Khatabook|S18||
Mutiny|S18|mutiny,mutinyhq|Mutiny
Kobo360|S18||
Ashby|W19||
Deel|W19||
Kalshi|W19||
Middesk|W19||
Glide|W19|glideapps,glide|Glide
54gene|W19||
Doppler|W19|doppler,dopplerhq|Doppler
Metronome|||
Vahan|||
Frubana|||
Hightouch|S19||
Rudderstack|S19|rudderstack,rudderlabs|RudderStack
Pave|S19|pave,pavecomp|Pave
Gather|S19|gather,gathertown|Gather
Fampay|S19|fampay,famapp|FamPay,FamApp
Dover|S19||
Paragon|S19|paragon,useparagon|Paragon
Truora|||
Fondeadora|||
PostHog|W20||
Airbyte|W20||
Whatnot|W20||
Secureframe|W20||
Fly.io|W20|flyio,fly|Fly.io
QuestDB|||
Fig||fig,withfig|Fig
Airplane||airplane,airplanedev|Airplane
Cortex|W20|cortex,cortexapps|Cortex
Release||releasehub,release|Release
Kovi|||
Supabase|S20||
Lightdash|||
Humanloop|S20||
Pachama|S20||
Jeeves|S20|jeeves,tryjeeves|Jeeves
Yassir|S20||
Daybreak Health||daybreakhealth|Daybreak
AtoB|S20||
Datafold|S20||
SuperTokens|S20||
Porter||porter,porterdev|Porter
Elenas|||
Zepto|W21|zepto,zeptonow|Zepto
Arc|W21|arc,arcfinance,arc-technologies|Arc
Svix|W21||
June|W21|june,juneso|June
Mono|W21|mono,monoafrica,withmono|Mono
Reliance Health||reliancehealth|Reliance Health
Ollama|W21||
Metaplane|W21||
Warrant|W21||
Polytomic|||
Prequel|||
Thepeer|||
Brick|||
Vapi||vapi,vapiai|Vapi
Remotebase|||
Abhi||abhi,abhifinance|Abhi
Safepay|||
Lago|S21|lago,getlago|Lago
Tavus|S21||
Rootly|S21||
OneSchema|S21||
Openlayer|S21||
Encore||encore,encoredev|Encore
Chari||chari,chari-ma|Chari
Khazna|||
Treinta|||
Tributi|||
Truck It In||truckitin|Truck It In
Dukaan|S21|dukaan,mydukaan|Dukaan
Dastgyr|||
Tag||tag,tagpk,tagbank|TAG
Zaraye|||
Dopay|||
Mintlify|W22||
YoLa Fresh||yolafresh|YoLa
Windmill|S22|windmill,windmilldev|Windmill
Medplum|S22||
Neem||neem,neemexchange|Neem
Juicebox|S22||
Replo|||
Firecrawl|S22|firecrawl,mendable|Firecrawl,Mendable
Resend|W23||
Trigger.dev|W23|triggerdev,trigger|Trigger.dev
Infisical|W23||
Langfuse|W23||
Helicone|W23||
Pylon|W23|pylon,usepylon,pylonlabs|Pylon
Fern|W23|fern,buildwithfern|Fern
Highlight|W23|highlight,highlightio|Highlight
Vellum|W23|vellum,vellumai|Vellum
Cerebrium|W23||
PlayHT||playht|PlayHT,Play.ht
Truewind|W23||
Magic Patterns|W23|magicpatterns|Magic Patterns
Tennr|||
Nango|W23||
LiteLLM|W23|berriai,litellm|LiteLLM,BerriAI
Athina|W23||
Sweep||sweep,sweepai|Sweep
Bland AI||bland,blandai|Bland
Continue||continue,continuedev|Continue
Leya||leya,leyalaw|Leya
Parea|S23||
Twenty|S23|twenty,twentycrm|Twenty
Greptile|W24||
Reducto|W24|reducto,reductoai|Reducto
Retell AI|W24|retellai,retell|Retell
Momentic|W24||
Trieve|W24||
Onyx|W24|onyx,danswer|Onyx,Danswer
Ragas|W24||
Artisan|W24|artisan,artisanai|Artisan
Toma|W24|toma,tomaai|Toma
K-Scale Labs|W24|kscale,kscalelabs|K-Scale
Parahelp|||
Unsloth|S24|unsloth,unslothai|Unsloth
Mem0|S24|mem0,mem0ai|Mem0
Laminar|S24|laminar,lmnr|Laminar
Coval|S24||
Hamming|S24|hamming,hammingai|Hamming
Browser Use|W25|browseruse,browser-use|Browser Use
Bazaar||bazaar,bazaartech,bazaar-technologies|Bazaar
Gorgias|||
Writesonic|||
Kudi||kudi,nomba|Nomba,Kudi
Bloc|||
Afriex|||
Edukoya|||
Releaf|||
Glass Health||glasshealth|Glass Health
Koala||koala,getkoala|Koala
Coco Robotics||cocorobotics,coco|Coco
Kubecost|||
Nowports|||
Trella|||
Breadfast|||
Muawin|||
Bitmovin|S15||
Pachyderm|W15||
Weave||getweave,weave|Weave
Gobble|||
Farmstead|||
Zumper|||
Holberton School||holbertonschool,holberton|Holberton
Nuvocargo|||
Wild Earth||wildearth|Wild Earth
Kikoff|||
Cofactor Genomics||cofactorgenomics|Cofactor
Campfire||campfire,campfirehq|Campfire
Balance||getbalance,balance|Balance
Slope||slope,slopepay|Slope
Stack AI||stackai|Stack AI
Credal||credal,credalai|Credal
Fini||fini,usefini|Fini
Ellipsis||ellipsis,ellipsisdev|Ellipsis
Tusk||tusk,usetusk|Tusk
Shadeform|S23||
OpenPipe|S23||
Atla|S23|atla,atla-ai|Atla
Superagent||superagent|Superagent
Corgi||corgi,corgiinsure|Corgi
GovDash||govdash|GovDash
Hyperbound||hyperbound|Hyperbound
QA Wolf||qawolf|QA Wolf
Lumos||lumos|Lumos
`;

type Company = { name: string; batch: string; slugs: string[]; aliases: string[] };

const companies: Company[] = [];
{
  const seen = new Set<string>();
  for (const line of RAW.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [name, batch = "", slugs = "", aliases = ""] = line.split("|");
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    companies.push({
      name,
      batch,
      slugs: slugs.split(",").map((s) => s.trim()).filter(Boolean),
      aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
}

const seed = JSON.parse(readFileSync("src/lib/feed/companies.json", "utf8")) as Record<string, string[]>;
const seedAll = new Set(Object.values(seed).flat().map((s) => s.toLowerCase()));

// ---------- HTTP ----------
const slots = new Map<string, { active: number; queue: (() => void)[] }>();
async function withSlot<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let s = slots.get(key);
  if (!s) slots.set(key, (s = { active: 0, queue: [] }));
  if (s.active < HOST_CONCURRENCY) s.active++;
  else await new Promise<void>((r) => s.queue.push(r));
  try {
    return await fn();
  } finally {
    const next = s.queue.shift();
    if (next) next();
    else s.active--;
  }
}
let requests = 0;
async function get(url: string, slotKey = new URL(url).host): Promise<unknown | null> {
  return withSlot(slotKey, async () => {
    requests++;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  });
}

// ---------- name matching ----------
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = (c: Company) => [c.name, ...c.aliases];
/** Organization-name field match (Greenhouse company_name, Workable name, Recruitee/SmartRecruiters company). */
function orgMatches(c: Company, org: string | undefined | null): boolean {
  if (!org) return false;
  const o = norm(org);
  return names(c).some((n) => {
    const k = norm(n);
    return k.length > 0 && (o === k || (k.length >= 4 && (o.startsWith(k) || o.includes(k))) || (o.length >= 4 && k.startsWith(o)));
  });
}
/** Free-text match (Lever/Ashby descriptions): case-sensitive word match of the brand as written. */
function textMentions(c: Company, text: string): boolean {
  return names(c).some((n) => {
    const re = new RegExp(`(^|[^A-Za-z0-9])${esc(n)}($|[^A-Za-z0-9])`, n.length <= 6 ? "" : "i");
    return re.test(text);
  });
}

function slugCandidates(c: Company): string[] {
  const base = norm(c.name);
  const hy = c.name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const out = [...c.slugs, base, hy, base + "hq", base + "inc"];
  if (!/ai$/.test(base)) out.push(base + "ai");
  return [...new Set(out.filter(Boolean))];
}

// Manually reviewed same-slug/different-company collisions (job text describes another business).
const REJECT = new Set([
  "greenhouse:zencoder", // Zencoder.ai (AI agents), not the YC S10 video encoder
  "greenhouse:encore", // travel program for 55+, not Encore.dev
  "greenhouse:porter", // Porter Works (interior design)
  "greenhouse:momentic", // Momentic Studios / SweatHouz
  "greenhouse:gatherai", // Gather AI (warehouse drones), not Gather (gather.town)
  "lever:tag", // Technology Advancement Group (US defense), not TAG Pakistan
  "ashby:highlightai", // Highlight (workforce AI), not highlight.io
  "ashby:boom", // Boom (renter payments), not Boom Supersonic
  "ashby:twenty", // Twenty (cyber defense), not Twenty CRM
  "ashby:pylon", // Pylon (mortgage), not Pylon (support platform)
  "ashby:sweep", // Sweep (Salesforce metadata), not Sweep AI
  "recruitee:spring", // SPRiNG (French recruiting), not Spring/Teespring
  "lever:porter", // Porter Cares (home health), not Porter (YC S20 PaaS)
  "greenhouse:weave", // Weave (drug-development AI), not Weave Communications
  "smartrecruiters:clerky", // single posting with an unrelated Burlingame address
]);

type Hit = { source: string; slug: string; jobs: number; org?: string };

async function probeGreenhouse(c: Company, slug: string): Promise<Hit | null> {
  const d = (await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`)) as
    | { jobs?: { company_name?: string }[] }
    | null;
  const jobs = d?.jobs ?? [];
  if (!jobs.length) return null;
  const org = jobs.find((j) => j.company_name)?.company_name;
  return orgMatches(c, org) ? { source: "greenhouse", slug, jobs: jobs.length, org } : null;
}
async function probeLever(c: Company, slug: string): Promise<Hit | null> {
  const d = (await get(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`)) as
    | { descriptionPlain?: string; additionalPlain?: string; lists?: { content: string }[] }[]
    | null;
  if (!Array.isArray(d) || !d.length) return null;
  const mentions = d.filter((p) => textMentions(c, [p.descriptionPlain, p.additionalPlain, ...(p.lists ?? []).map((l) => l.content)].join("\n"))).length;
  return mentions >= Math.min(2, d.length) ? { source: "lever", slug, jobs: d.length } : null;
}
async function probeAshby(c: Company, slug: string): Promise<Hit | null> {
  const d = (await get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`)) as
    | { jobs?: { isListed?: boolean; descriptionPlain?: string; title?: string }[] }
    | null;
  const jobs = (d?.jobs ?? []).filter((j) => j.isListed !== false);
  if (!jobs.length) return null;
  const mentions = jobs.filter((j) => textMentions(c, j.descriptionPlain ?? "")).length;
  return mentions >= Math.min(2, jobs.length) ? { source: "ashby", slug, jobs: jobs.length } : null;
}
async function probeWorkable(c: Company, slug: string): Promise<Hit | null> {
  const d = (await get(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`)) as
    | { name?: string; jobs?: unknown[] }
    | null;
  const n = d?.jobs?.length ?? 0;
  return n && orgMatches(c, d?.name) ? { source: "workable", slug, jobs: n, org: d?.name } : null;
}
async function probeRecruitee(c: Company, slug: string): Promise<Hit | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const d = (await get(`https://${slug}.recruitee.com/api/offers/`, "recruitee.com")) as
    | { offers?: { company_name?: string }[] }
    | null;
  const offers = d?.offers ?? [];
  if (!offers.length) return null;
  const org = offers.find((o) => o.company_name)?.company_name;
  return orgMatches(c, org) ? { source: "recruitee", slug, jobs: offers.length, org } : null;
}
async function probeSmartRecruiters(c: Company, slug: string): Promise<Hit | null> {
  const d = (await get(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=100`)) as
    | { totalFound?: number; content?: { company?: { name?: string } }[] }
    | null;
  const content = d?.content ?? [];
  if (!content.length) return null;
  const org = content[0]?.company?.name;
  return orgMatches(c, org) ? { source: "smartrecruiters", slug, jobs: d?.totalFound ?? content.length, org } : null;
}

const PROBES: [string, (c: Company, s: string) => Promise<Hit | null>, boolean][] = [
  ["greenhouse", probeGreenhouse, true],
  ["lever", probeLever, true],
  ["ashby", probeAshby, true],
  // Fewer variants on the smaller ATSes to keep request volume polite.
  ["workable", probeWorkable, false],
  ["recruitee", probeRecruitee, false],
  ["smartrecruiters", probeSmartRecruiters, false],
];

type Result = { company: Company; hit: Hit | null; skipped?: string };

async function probeCompany(c: Company): Promise<Result> {
  const cands = slugCandidates(c);
  // Pre-skip only on the primary slugs (a secondary guess like "relativity" may be a different company).
  const inSeed = [norm(c.name), c.slugs[0]].find((s) => s && seedAll.has(s));
  if (inSeed) return { company: c, hit: null, skipped: `seed:${inSeed}` };
  for (const [, fn, full] of PROBES) {
    const list = full ? cands : cands.slice(0, Math.max(2, c.slugs.length + 1));
    for (const s of list) {
      const hit = await fn(c, s);
      if (hit && REJECT.has(`${hit.source}:${hit.slug}`)) continue;
      if (hit) {
        if ((seed[hit.source] ?? []).map((x) => x.toLowerCase()).includes(hit.slug.toLowerCase()))
          return { company: c, hit: null, skipped: `seed:${hit.slug}` };
        return { company: c, hit };
      }
    }
  }
  return { company: c, hit: null };
}

const results: Result[] = [];
let idx = 0;
await Promise.all(
  Array.from({ length: COMPANY_CONCURRENCY }, async () => {
    while (idx < companies.length) {
      const c = companies[idx++];
      const r = await probeCompany(c);
      results.push(r);
      const tag = r.hit ? `${r.hit.source}:${r.hit.slug} (${r.hit.jobs})${r.hit.org ? ` org="${r.hit.org}"` : ""}` : (r.skipped ?? "none");
      console.log(`${c.name.padEnd(22)} ${tag}`);
    }
  }),
);

// ---------- output ----------
const out: Record<string, string[]> = { greenhouse: [], lever: [], ashby: [], workable: [], recruitee: [], smartrecruiters: [] };
const meta: Record<string, { company: string; batch?: string; jobs: number }> = {};
const seenKeys = new Set<string>();
for (const r of results.sort((a, b) => a.company.name.localeCompare(b.company.name))) {
  if (!r.hit) continue;
  const key = `${r.hit.source}:${r.hit.slug}`;
  if (seenKeys.has(key)) continue;
  seenKeys.add(key);
  out[r.hit.source].push(r.hit.slug);
  meta[key] = { company: r.company.name, ...(r.company.batch ? { batch: r.company.batch } : {}), jobs: r.hit.jobs };
}
for (const k of Object.keys(out)) out[k].sort();
writeFileSync("src/lib/feed/yc-companies.json", JSON.stringify(out, null, 2) + "\n");
writeFileSync("src/lib/feed/yc-companies.meta.json", JSON.stringify(meta, null, 2) + "\n");

const conf = results;
const summary = {
  requests,
  tried: results.length,
  skippedSeed: conf.filter((r) => r.skipped).length,
  verified: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.length])),
  totalJobs: Object.values(meta).reduce((a, m) => a + m.jobs, 0),
  noBoard: conf.filter((r) => !r.hit && !r.skipped).map((r) => r.company.name),
  skipped: conf.filter((r) => r.skipped).map((r) => `${r.company.name}=${r.skipped}`),
};
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
