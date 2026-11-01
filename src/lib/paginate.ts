// Shared pagination for list pages and list APIs. Every list the app shows should go through
// this so no query returns an unbounded number of rows.

export const PAGE_SIZE = 50;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

export function pageFrom(params: Params, size = PAGE_SIZE) {
  const raw = params instanceof URLSearchParams ? params.get("page") : params.page;
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  const page = Number.isInteger(n) && n > 0 ? n : 1;
  return { page, limit: size, offset: (page - 1) * size };
}

export const pageCount = (total: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size));
