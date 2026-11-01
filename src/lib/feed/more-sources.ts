import "server-only";
import { FetchError, getJson, getText, mapLimit, postJson } from "./http";
import { clip, decodeEntities, htmlToText, isRemoteText, prettyBoard, toIso } from "./text";
import { AUTO_APPLY, type JobListing } from "./types";
import boardNames from "./board-names.json";

// Read-only collectors for Workable, SmartRecruiters, Recruitee, Personio and Workday public job endpoints.
// None of them needs an API key; all of them are the JSON/XML the ATS's own career pages read.

/** Per-run hints from the user's preferences, so big boards can be searched instead of paged through. */
export type FetchContext = {
  searchTerms?: string[]; // target titles, used as keyword searches on very large boards
  wantTitle?: (title: string) => boolean; // jobs worth a detail request (description, exact location)
};

const NAMES: Record<string, string> = boardNames;
const nameFor = (source: string, board: string, fallback: string) => NAMES[`${source}:${board}`] ?? fallback;

// ---------- Workable ----------

type WorkableJob = {
  title: string;
  shortcode: string;
  telecommuting?: boolean;
  url?: string;
  published_on?: string;
  created_at?: string;
  city?: string;
  state?: string;
  country?: string;
  locations?: { city?: string; region?: string; country?: string; hidden?: boolean }[];
  description?: string;
  department?: string;
  employment_type?: string;
};

/** One request per account: the careers-widget endpoint returns every published job with its description. */
export async function fetchWorkableBoard(slug: string, via = "seed"): Promise<JobListing[]> {
  const data = await getJson<{ name?: string; jobs?: WorkableJob[] }>(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`,
  );
  const company = data.name?.trim() || prettyBoard(slug);
  return (data.jobs ?? []).map((j) => {
    const places = (j.locations?.length ? j.locations.filter((l) => !l.hidden) : [{ city: j.city, region: j.state, country: j.country }])
      .map((l) => [l.city, l.country].filter(Boolean).join(", "))
      .filter(Boolean);
    let location = [...new Set(places)].join("; ");
    if (j.telecommuting && !isRemoteText(location)) location = location ? `Remote; ${location}` : "Remote";
    const url = `https://apply.workable.com/${slug}/j/${j.shortcode}/`;
    return {
      source: "workable",
      board: slug,
      externalId: j.shortcode,
      url,
      applyUrl: `${url}apply/`,
      title: j.title.trim(),
      company,
      location,
      remote: Boolean(j.telecommuting) || isRemoteText(location) || /\bremote\b/i.test(j.title),
      postedAt: toIso(j.published_on ?? j.created_at),
      description: clip(htmlToText(j.description ?? "")),
      discoveredVia: via,
      autoApply: AUTO_APPLY.workable,
    } satisfies JobListing;
  });
}

// ---------- SmartRecruiters ----------

type SrPosting = {
  id: string;
  name: string;
  releasedDate?: string;
  company?: { identifier?: string; name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; fullLocation?: string };
  typeOfEmployment?: { label?: string };
};
type SrPage = { totalFound: number; offset: number; limit: number; content: SrPosting[] };
type SrDetail = SrPosting & {
  postingUrl?: string;
  applyUrl?: string;
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
};

const SR_PAGE = 100;
const SR_MAX_PAGES = 5; // boards up to 500 postings are read in full
const SR_SEARCH_PAGES = 2; // bigger boards: per search term
const SR_MAX_DETAILS = 15; // description requests per board, for title-matching postings only

const srSlug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export async function fetchSmartRecruitersBoard(companyId: string, via = "seed", ctx: FetchContext = {}): Promise<JobListing[]> {
  const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyId)}/postings`;
  const page = (offset: number, q?: string) =>
    getJson<SrPage>(`${base}?limit=${SR_PAGE}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`);

  const byId = new Map<string, SrPosting>();
  const first = await page(0);
  for (const p of first.content ?? []) byId.set(p.id, p);
  const terms = (ctx.searchTerms ?? []).filter((t) => t.trim()).slice(0, 3);
  if (first.totalFound <= SR_PAGE * SR_MAX_PAGES || !terms.length) {
    const pages = Math.min(Math.ceil(first.totalFound / SR_PAGE), SR_MAX_PAGES);
    const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page((i + 1) * SR_PAGE)));
    for (const r of rest) for (const p of r.content ?? []) byId.set(p.id, p);
  } else {
    for (const term of terms) {
      for (let i = 0; i < SR_SEARCH_PAGES; i++) {
        const r = await page(i * SR_PAGE, term);
        for (const p of r.content ?? []) byId.set(p.id, p);
        if ((i + 1) * SR_PAGE >= r.totalFound) break;
      }
    }
  }

  const postings = [...byId.values()];
  const wanted = ctx.wantTitle ? postings.filter((p) => ctx.wantTitle!(p.name)).slice(0, SR_MAX_DETAILS) : [];
  const details = new Map<string, SrDetail>();
  await mapLimit(wanted, 4, async (p) => {
    try {
      details.set(p.id, await getJson<SrDetail>(`${base}/${encodeURIComponent(p.id)}`));
    } catch {
      // the list entry is still usable without its description
    }
  });

  return postings.map((p) => {
    const d = details.get(p.id);
    const id = p.company?.identifier || companyId;
    const location = p.location?.fullLocation?.replace(/,\s*,/g, ",").trim() || [p.location?.city, p.location?.country].filter(Boolean).join(", ");
    const remote = Boolean(p.location?.remote) || isRemoteText(location) || /\bremote\b/i.test(p.name);
    const url = d?.postingUrl || `https://jobs.smartrecruiters.com/${id}/${p.id}-${srSlug(p.name)}`;
    const sections = Object.values(d?.jobAd?.sections ?? {})
      .filter((s): s is { title?: string; text?: string } => Boolean(s?.text))
      .map((s) => `${s.title ? `${s.title}\n` : ""}${htmlToText(s.text!)}`);
    return {
      source: "smartrecruiters",
      board: companyId,
      externalId: p.id,
      url,
      // The API's own applyUrl is the posting URL plus ?oga=true; build the same when we skipped the detail call.
      applyUrl: d?.applyUrl || `${url}?oga=true`,
      title: p.name.trim(),
      company: p.company?.name?.trim() || prettyBoard(companyId),
      location: remote && !isRemoteText(location) ? `Remote; ${location}` : location,
      remote,
      postedAt: toIso(p.releasedDate),
      description: clip(sections.join("\n\n")),
      discoveredVia: via,
      autoApply: AUTO_APPLY.smartrecruiters,
    } satisfies JobListing;
  });
}

// ---------- Recruitee ----------

type RecruiteeOffer = {
  id: number;
  slug: string;
  title: string;
  company_name?: string;
  careers_url?: string;
  careers_apply_url?: string;
  location?: string;
  locations?: { city?: string; country?: string; name?: string }[];
  remote?: boolean;
  published_at?: string;
  created_at?: string;
  description?: string;
  requirements?: string;
  status?: string;
};

export async function fetchRecruiteeBoard(slug: string, via = "seed"): Promise<JobListing[]> {
  const data = await getJson<{ offers?: RecruiteeOffer[] }>(`https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`);
  return (data.offers ?? [])
    .filter((o) => !o.status || o.status === "published")
    .map((o) => {
      const places = (o.locations ?? []).map((l) => [l.city || l.name, l.country].filter(Boolean).join(", ")).filter(Boolean);
      let location = places.length ? [...new Set(places)].join("; ") : (o.location ?? "");
      if (o.remote && !isRemoteText(location)) location = location ? `Remote; ${location}` : "Remote";
      const url = o.careers_url || `https://${slug}.recruitee.com/o/${o.slug}`;
      return {
        source: "recruitee",
        board: slug,
        externalId: String(o.id),
        url,
        applyUrl: o.careers_apply_url || `https://${slug}.recruitee.com/o/${o.slug}/c/new`,
        title: o.title.trim(),
        company: o.company_name?.trim() || prettyBoard(slug),
        location,
        remote: Boolean(o.remote) || isRemoteText(location),
        postedAt: toIso((o.published_at ?? o.created_at)?.replace(" UTC", "Z").replace(" ", "T")),
        description: clip(htmlToText(`${o.description ?? ""}\n${o.requirements ?? ""}`)),
        discoveredVia: via,
        autoApply: AUTO_APPLY.recruitee,
      } satisfies JobListing;
    });
}

// ---------- Personio ----------

const xmlTag = (block: string, tag: string) => {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return "";
  const v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : decodeEntities(v);
};

/** `board` is the subdomain ("acme" → acme.jobs.personio.de, falling back to .com) or a full host. */
export async function fetchPersonioBoard(board: string, via = "seed"): Promise<JobListing[]> {
  const hosts = board.includes(".") ? [board] : [`${board}.jobs.personio.de`, `${board}.jobs.personio.com`];
  let xml = "";
  let host = hosts[0];
  for (const h of hosts) {
    try {
      xml = await getText(`https://${h}/xml?language=en`, "application/xml");
      host = h;
      break;
    } catch (e) {
      if (!(e instanceof FetchError && e.status === 404) || h === hosts[hosts.length - 1]) throw e;
    }
  }
  if (!xml.includes("<workzag-jobs")) throw new FetchError(null, "not a Personio XML feed");
  const fallbackCompany = nameFor("personio", board, prettyBoard(board.split(".")[0]));
  return [...xml.matchAll(/<position>([\s\S]*?)<\/position>/g)].map(([, p]) => {
    const id = xmlTag(p, "id");
    const offices = [xmlTag(p, "office"), ...[...(xmlTag(p, "additionalOffices").matchAll(/<office>([\s\S]*?)<\/office>/g))].map((m) => decodeEntities(m[1].trim()))];
    const location = [...new Set(offices.filter(Boolean))].join("; ");
    const sections = [...p.matchAll(/<jobDescription>([\s\S]*?)<\/jobDescription>/g)].map(([, d]) => {
      const name = xmlTag(d, "name");
      return `${name ? `${name}\n` : ""}${htmlToText(xmlTag(d, "value"))}`;
    });
    const meta = [xmlTag(p, "department"), xmlTag(p, "seniority"), xmlTag(p, "schedule"), xmlTag(p, "yearsOfExperience") && `${xmlTag(p, "yearsOfExperience")} years`]
      .filter(Boolean)
      .join(" · ");
    const title = xmlTag(p, "name");
    const url = `https://${host}/job/${id}`;
    return {
      source: "personio",
      board,
      externalId: id,
      url,
      applyUrl: url,
      title,
      company: nameFor("personio", board, xmlTag(p, "subcompany") || fallbackCompany),
      location,
      remote: isRemoteText(location) || /\bremote\b/i.test(title),
      postedAt: toIso(xmlTag(p, "createdAt")),
      description: clip([meta, ...sections].filter(Boolean).join("\n\n")),
      discoveredVia: via,
      autoApply: AUTO_APPLY.personio,
    } satisfies JobListing;
  });
}

// ---------- Workday ----------

type WdPosting = { title: string; externalPath: string; locationsText?: string; postedOn?: string; bulletFields?: string[]; remoteType?: string };
type WdPage = { total: number; jobPostings?: WdPosting[] };
type WdDetail = {
  jobPostingInfo?: {
    id?: string;
    title?: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    startDate?: string;
    jobReqId?: string;
    remoteType?: string;
    externalUrl?: string;
    country?: { descriptor?: string };
  };
};

const WD_PAGE = 20;
const WD_MAX_PAGES = 5; // per board per run, across all search terms
const WD_MAX_DETAILS = 12; // description requests per board, for title-matching postings only

/** "Posted Today" / "Posted Yesterday" / "Posted 3 Days Ago" / "Posted 30+ Days Ago" → ISO date. */
function workdayPostedOn(text: string | undefined, now = Date.now()): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  let days: number | null = null;
  if (t.includes("today")) days = 0;
  else if (t.includes("yesterday")) days = 1;
  else {
    const m = t.match(/(\d+)\s*(\+)?\s*days?/);
    if (m) days = Number(m[1]) + (m[2] ? 1 : 0);
  }
  return days === null ? null : new Date(now - days * 86_400_000).toISOString();
}

/** Board "tenant|wdN|site", e.g. "nvidia|wd5|NVIDIAExternalCareerSite". */
function parseWorkdayBoard(board: string): { tenant: string; wd: string; site: string } | null {
  const [tenant, wd, site] = board.split("|");
  return tenant && /^wd\d+$/i.test(wd ?? "") && site ? { tenant, wd: wd.toLowerCase(), site } : null;
}

export async function fetchWorkdayBoard(board: string, via = "seed", ctx: FetchContext = {}): Promise<JobListing[]> {
  const wb = parseWorkdayBoard(board);
  if (!wb) throw new FetchError(null, `bad Workday board "${board}" (want tenant|wdN|site)`);
  const origin = `https://${wb.tenant}.${wb.wd}.myworkdayjobs.com`;
  const api = `${origin}/wday/cxs/${wb.tenant}/${wb.site}`;
  const list = (offset: number, searchText: string) =>
    postJson<WdPage>(`${api}/jobs`, { limit: WD_PAGE, offset, searchText, appliedFacets: {} });

  // Search for the target titles when we have them (keeps 2,000-job boards small); otherwise the newest pages.
  const terms = (ctx.searchTerms ?? []).filter((t) => t.trim()).slice(0, 3);
  const queries = terms.length ? terms : [""];
  const byPath = new Map<string, WdPosting>();
  let budget = WD_MAX_PAGES;
  for (let qi = 0; qi < queries.length && budget > 0; qi++) {
    // Spread the page budget over the remaining terms.
    const pagesForTerm = Math.max(1, Math.floor(budget / (queries.length - qi)));
    for (let i = 0; i < pagesForTerm && budget > 0; i++) {
      budget--;
      const r = await list(i * WD_PAGE, queries[qi]);
      for (const p of r.jobPostings ?? []) if (p.externalPath) byPath.set(p.externalPath, p);
      if ((i + 1) * WD_PAGE >= r.total || !r.jobPostings?.length) break;
    }
  }

  const postings = [...byPath.values()];
  const wanted = ctx.wantTitle ? postings.filter((p) => ctx.wantTitle!(p.title)).slice(0, WD_MAX_DETAILS) : [];
  const details = new Map<string, NonNullable<WdDetail["jobPostingInfo"]>>();
  await mapLimit(wanted, 2, async (p) => {
    try {
      const d = await getJson<WdDetail>(`${api}${p.externalPath}`);
      if (d.jobPostingInfo) details.set(p.externalPath, d.jobPostingInfo);
    } catch {
      // keep the list entry
    }
  });

  const company = nameFor("workday", board, prettyBoard(wb.tenant));
  return postings.map((p) => {
    const d = details.get(p.externalPath);
    const locs = d ? [d.location, ...(d.additionalLocations ?? [])].filter(Boolean) : [p.locationsText ?? ""];
    let location = [...new Set(locs)].join("; ");
    // Workday locations are often just a city ("Raleigh"); add the country so location matching works.
    const country = d?.country?.descriptor;
    if (country && !location.toLowerCase().includes(country.toLowerCase())) location = `${location} (${country})`.trim();
    const remoteType = d?.remoteType ?? p.remoteType ?? "";
    const remote = /remote/i.test(remoteType) || isRemoteText(location) || /\bremote\b/i.test(p.title);
    const reqId = d?.jobReqId ?? p.bulletFields?.[0] ?? "";
    return {
      source: "workday",
      board,
      // Req ids are stable per tenant; the external path also changes when a job's primary location does.
      externalId: reqId || p.externalPath,
      url: d?.externalUrl || `${origin}/${wb.site}${p.externalPath}`,
      applyUrl: d?.externalUrl || `${origin}/${wb.site}${p.externalPath}`,
      title: (d?.title ?? p.title).trim(),
      company,
      location,
      remote,
      postedAt: toIso(d?.startDate) ?? workdayPostedOn(p.postedOn),
      description: clip(htmlToText(d?.jobDescription ?? "")),
      discoveredVia: via,
      autoApply: AUTO_APPLY.workday,
    } satisfies JobListing;
  });
}
