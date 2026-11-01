import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { Nav } from "@/components/Nav";
import { UploadCard } from "@/components/UploadCard";
import { ListSkeleton } from "@/components/Skeleton";
import { PAGE_SIZE } from "@/lib/paginate";

export default function Home() {
  return (
    <>
    <Nav active="/" />
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">ApplyKit</h1>
      <p className="mt-2 text-neutral-600">
        Upload your resume. AI turns it into structured data that you can edit and export.
      </p>

      <div className="mt-8">
        <UploadCard />
      </div>

      <h2 className="mt-12 mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500">Your resumes</h2>
      <Suspense fallback={<ListSkeleton rows={3} />}>
        <ResumeList />
      </Suspense>
    </main>
    </>
  );
}

async function ResumeList() {
  await connection();
  const db = await getDb();
  const rows = await db
    .select({ id: schema.resumes.id, title: schema.resumes.title, updatedAt: schema.resumes.updatedAt })
    .from(schema.resumes)
    .orderBy(desc(schema.resumes.updatedAt))
    .limit(PAGE_SIZE);

  return rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No resumes yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/resumes/${r.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50">
                <span className="font-medium">{r.title}</span>
                <span className="text-xs text-neutral-500">
                  Edited {r.updatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      );
}
