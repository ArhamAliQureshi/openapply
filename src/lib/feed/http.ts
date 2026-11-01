import "server-only";

// Polite HTTP for the feed collectors: one User-Agent, 20s timeout, a per-host concurrency cap
// (stricter for hosts that rate-limit), and one retry on HTTP 429.

export const UA = "ApplyKit/0.1 (personal job search)";
const TIMEOUT_MS = 20_000;
const DEFAULT_HOST_CONCURRENCY = 4;
// Across all hosts. With ~400 boards on ~300 hosts, unbounded parallel connects fail with "fetch failed".
const GLOBAL_CONCURRENCY = 24;

// Hosts with tighter limits. Workday hosts are per tenant ("acme.wd5.myworkdayjobs.com").
// apply.workable.com answers 429 (Cloudflare 1015) quickly when hit in parallel, so it gets 2 slots and spacing.
const HOST_RULES: { test: RegExp; concurrency: number; minGapMs: number }[] = [
  { test: /\.myworkdayjobs\.com$/i, concurrency: 2, minGapMs: 0 },
  { test: /^apply\.workable\.com$/i, concurrency: 2, minGapMs: 350 },
];

export class FetchError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Slot = { active: number; queue: (() => void)[]; limit: number; minGapMs: number; lastStart: number };
const slots = new Map<string, Slot>();
const globalSlot: Slot = { active: 0, queue: [], limit: GLOBAL_CONCURRENCY, minGapMs: 0, lastStart: 0 };

async function withSlot<T>(s: Slot, fn: () => Promise<T>): Promise<T> {
  if (s.active < s.limit) s.active++;
  else await new Promise<void>((resolve) => s.queue.push(resolve));
  try {
    return await fn();
  } finally {
    const next = s.queue.shift();
    if (next) next();
    else s.active--;
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// At most `limit` requests in flight per host (and GLOBAL_CONCURRENCY overall); a finished request hands its slot on.
async function withHostSlot<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = new URL(url).host;
  let slot = slots.get(host);
  if (!slot) {
    const rule = HOST_RULES.find((r) => r.test.test(host));
    slot = { active: 0, queue: [], limit: rule?.concurrency ?? DEFAULT_HOST_CONCURRENCY, minGapMs: rule?.minGapMs ?? 0, lastStart: 0 };
    slots.set(host, slot);
  }
  const s = slot;
  // Take the host slot first so a busy host doesn't hold global slots while it waits.
  return withSlot(s, () =>
    withSlot(globalSlot, async () => {
      if (s.minGapMs) {
        const wait = s.lastStart + s.minGapMs - Date.now();
        s.lastStart = Math.max(Date.now(), s.lastStart + s.minGapMs);
        if (wait > 0) await sleep(wait);
      }
      return fn();
    }),
  );
}

type RequestOpts = { method?: "GET" | "POST"; body?: unknown; accept?: string };

type Fetched = { status: number; retryAfter: string | null; body: string };

/** Fetches and reads the body inside the host/global slots, so slow downloads count against the caps too. */
async function request(url: string, opts: RequestOpts): Promise<Fetched> {
  for (let attempt = 0; ; attempt++) {
    const res = await withHostSlot(url, async (): Promise<Fetched> => {
      try {
        const r = await fetch(url, {
          method: opts.method ?? "GET",
          headers: {
            "User-Agent": UA,
            Accept: opts.accept ?? "application/json",
            ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return { status: r.status, retryAfter: r.headers.get("retry-after"), body: r.ok ? await r.text() : "" };
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        const cause = e instanceof Error && e.cause instanceof Error ? ` (${e.cause.message})` : "";
        throw new FetchError(null, name === "TimeoutError" ? "timeout after 20s" : `${String(e)}${cause}`);
      }
    });
    if (res.status === 429 && attempt === 0) {
      // One polite retry, outside the host slot so other boards keep moving.
      const after = Number(res.retryAfter);
      await sleep(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 3000, 8000));
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new FetchError(res.status, `HTTP ${res.status}`);
    return res;
  }
}

export async function getJson<T>(url: string, opts: Omit<RequestOpts, "accept"> = {}): Promise<T> {
  const res = await request(url, opts);
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new FetchError(res.status, "invalid JSON");
  }
}

export const postJson = <T>(url: string, body: unknown) => getJson<T>(url, { method: "POST", body });

export async function getText(url: string, accept = "*/*"): Promise<string> {
  return (await request(url, { accept })).body;
}

/** Runs `fn` over `items` with at most `n` in flight (on top of the per-host caps). */
export async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
