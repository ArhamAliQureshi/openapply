// Placeholder shapes shown while server data streams in. They mirror each page's layout so
// content doesn't jump when it arrives.

export function Bar({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden style={style} className={`animate-pulse rounded bg-neutral-200 ${className}`} />;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-neutral-200 bg-white p-5 ${className}`}>{children}</div>;
}

/** A bordered list of rows, e.g. applications, answers, resumes. */
export function ListSkeleton({ rows = 6, className = "" }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={`divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white ${className}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-4 py-3.5">
          {/* Vary widths so it reads as text, not a grid. */}
          <Bar className="h-4" style={{ width: `${45 + ((i * 17) % 35)}%` }} />
          <Bar className="h-4 w-20 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Stacked form cards, e.g. profile and settings. */
export function FormSkeleton({ cards = 3, className = "" }: { cards?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={`space-y-4 ${className}`}>
      {Array.from({ length: cards }, (_, i) => (
        <Card key={i}>
          <Bar className="h-4 w-40" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} className="space-y-1.5">
                <Bar className="h-3 w-24" />
                <Bar className="h-8 w-full" />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

/** Jobs page: two settings cards and a job list with score badges. */
export function JobsSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="mt-6 space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} className="space-y-3">
            <Bar className="h-4 w-44" />
            <Bar className="h-8 w-full" />
            <Bar className="h-8 w-full" />
            <Bar className="h-8 w-2/3" />
          </Card>
        ))}
      </div>
      <div className="rounded-xl border border-neutral-200 bg-white">
        <div className="flex gap-4 border-b border-neutral-200 px-4 py-3">
          {[0, 1, 2, 3].map((i) => (
            <Bar key={i} className="h-4 w-24" />
          ))}
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-start gap-4 border-b border-neutral-100 px-4 py-3 last:border-0">
            <Bar className="h-7 w-10 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bar className="h-4 w-2/3" />
              <Bar className="h-3 w-1/3" />
            </div>
            <Bar className="h-7 w-14 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** One application: header, a "needs you" card and the answers table. */
export function ApplicationSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="space-y-6">
      <div className="space-y-2">
        <Bar className="h-3 w-24" />
        <Bar className="h-7 w-2/3" />
        <Bar className="h-4 w-1/3" />
      </div>
      <Card className="flex gap-3">
        <Bar className="h-9 w-48" />
        <Bar className="h-9 w-36" />
      </Card>
      <ListSkeleton rows={8} />
    </div>
  );
}

/** Resume editor: form column and a page preview. */
export function EditorSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex h-screen flex-col">
      <div className="flex items-center gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <Bar className="h-4 w-20" />
        <Bar className="h-5 w-64" />
      </div>
      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(380px,1fr)_minmax(0,1.25fr)]">
        <div className="bg-neutral-100 p-4">
          <FormSkeleton cards={2} />
        </div>
        <div className="hidden bg-neutral-300 p-6 lg:block">
          <div className="mx-auto h-[11in] w-[8.5in] origin-top scale-[0.85] space-y-3 bg-white p-12">
            <Bar className="mx-auto h-6 w-1/2" />
            <Bar className="mx-auto h-3 w-1/3" />
            {Array.from({ length: 10 }, (_, i) => (
              <Bar key={i} className="h-3 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Agents dashboard: counter card and a couple of rows. */
export function AgentsSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="mt-6 space-y-6">
      <Card className="flex items-center gap-4">
        <div className="space-y-2">
          <Bar className="h-9 w-10" />
          <Bar className="h-3 w-20" />
        </div>
        <Bar className="h-6 w-40" />
      </Card>
      <ListSkeleton rows={4} />
    </div>
  );
}
