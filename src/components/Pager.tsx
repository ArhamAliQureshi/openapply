import Link from "next/link";

/** Prev/Next links that keep the page's other query params (e.g. the Jobs tab). */
export function Pager({
  page,
  pages,
  total,
  basePath,
  params = {},
}: {
  page: number;
  pages: number;
  total: number;
  basePath: string;
  params?: Record<string, string>;
}) {
  if (pages <= 1) return null;
  const href = (p: number) => `${basePath}?${new URLSearchParams({ ...params, page: String(p) })}`;
  const link = "rounded-md border border-neutral-300 px-3 py-1 hover:bg-neutral-50";
  const disabled = "rounded-md border border-neutral-200 px-3 py-1 text-neutral-300";
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-1 py-3 text-sm">
      <span className="text-neutral-500">
        Page {page} of {pages} · {total.toLocaleString()} total
      </span>
      <span className="flex gap-2">
        {page > 1 ? <Link href={href(page - 1)} className={link}>← Prev</Link> : <span className={disabled}>← Prev</span>}
        {page < pages ? <Link href={href(page + 1)} className={link}>Next →</Link> : <span className={disabled}>Next →</span>}
      </span>
    </nav>
  );
}
