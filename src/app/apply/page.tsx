import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { NewApplication } from "@/components/NewApplication";
import { Nav } from "@/components/Nav";
import { StatusBadge } from "@/components/StatusBadge";
import { getDb, schema } from "@/db";
import { ListSkeleton } from "@/components/Skeleton";
import { Pager } from "@/components/Pager";
import { pageCount, pageFrom } from "@/lib/paginate";

export default function ApplyPage(props: PageProps<"/apply">) {
  return (
    <>
      <Nav active="/apply" />
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Apply</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Paste a Greenhouse, Lever or Ashby job link. ApplyKit reads the form, plans every answer, and fills it in a hidden browser.
        </p>
        <div className="mt-6">
          <NewApplication />
        </div>
        <h2 className="mt-10 mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">Applications</h2>
        <Suspense fallback={<ListSkeleton />}>
          <ApplicationList searchParams={props.searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function ApplicationList({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { page, limit, offset } = pageFrom(await searchParams);
  const db = await getDb();
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(schema.applications),
    db
    .select({
      id: schema.applications.id,
      status: schema.applications.status,
      updatedAt: schema.applications.updatedAt,
      title: schema.jobs.title,
      company: schema.jobs.company,
    })
    .from(schema.applications)
    .innerJoin(schema.jobs, eq(schema.applications.jobId, schema.jobs.id))
    .orderBy(desc(schema.applications.updatedAt))
      .limit(limit)
      .offset(offset),
  ]);
  if (total === 0) return <p className="text-sm text-neutral-500">No applications yet.</p>;
  return (
    <>
    <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/apply/${r.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-50">
            <span>
              <span className="font-medium">{r.title}</span>
              <span className="text-neutral-500"> · {r.company}</span>
            </span>
            <StatusBadge status={r.status} />
          </Link>
        </li>
      ))}
    </ul>
    <Pager page={page} pages={pageCount(total)} total={total} basePath="/apply" />
    </>
  );
}
