import { asc, sql } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import { AnswerLibrary } from "@/components/AnswerLibrary";
import { Nav } from "@/components/Nav";
import { getDb, schema } from "@/db";
import { Pager } from "@/components/Pager";
import { ListSkeleton } from "@/components/Skeleton";
import { pageCount, pageFrom } from "@/lib/paginate";

export default function AnswersPage(props: PageProps<"/answers">) {
  return (
    <>
      <Nav active="/answers" />
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">Answer library</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Every question you answer is saved here and reused automatically when a form asks the same thing.
        </p>
        <Suspense fallback={<ListSkeleton className="mt-6" />}>
          <Loaded searchParams={props.searchParams} />
        </Suspense>
      </main>
    </>
  );
}

async function Loaded({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const { page, limit, offset } = pageFrom(await searchParams);
  const db = await getDb();
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(schema.answers),
    db
      .select({ id: schema.answers.id, question: schema.answers.question, answer: schema.answers.answer })
      .from(schema.answers)
      .orderBy(asc(schema.answers.question))
      .limit(limit)
      .offset(offset),
  ]);
  return (
    <>
      {/* Remount when the page or row count changes so local state picks up fresh server data. */}
      <AnswerLibrary key={`${page}-${total}`} initial={rows} />
      <Pager page={page} pages={pageCount(total)} total={total} basePath="/answers" />
    </>
  );
}
