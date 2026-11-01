import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";
import { ApplicationView } from "@/components/ApplicationView";
import { Nav } from "@/components/Nav";
import { getDb, schema } from "@/db";
import { ApplicationSkeleton } from "@/components/Skeleton";

export default function ApplicationPage(props: PageProps<"/apply/[id]">) {
  return (
    <>
      <Nav active="/apply" />
      <main className="mx-auto w-full max-w-4xl px-4 py-8">
        <Suspense fallback={<ApplicationSkeleton />}>
          <Loaded params={props.params} />
        </Suspense>
      </main>
    </>
  );
}

async function Loaded({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getDb();
  const [row] = await db
    // Not jobs.raw: the full ATS payload (form + description) isn't needed to render this page.
    .select({
      app: schema.applications,
      job: { title: schema.jobs.title, company: schema.jobs.company, location: schema.jobs.location, url: schema.jobs.url },
    })
    .from(schema.applications)
    .innerJoin(schema.jobs, eq(schema.applications.jobId, schema.jobs.id))
    .where(eq(schema.applications.id, id));
  if (!row) notFound();
  const { app, job } = row;
  return (
    <ApplicationView
      app={{
        id: app.id,
        status: app.status,
        plan: app.plan,
        log: app.log,
        error: app.error,
        hasScreenshot: !!app.screenshotPath,
        updatedAt: app.updatedAt.toISOString(),
      }}
      job={{ title: job.title, company: job.company, location: job.location, url: job.url }}
      liveEnabled={process.env.ALLOW_LIVE_SUBMIT === "true"}
    />
  );
}
