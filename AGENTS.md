<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ApplyKit project rules

Read `HANDOVER.md` (context, safety rules, code map) and `AUDIT.md` (open issues) before changing anything.

## Performance rules (apply to all new and changed code)

These are defaults, not optional extras. Use the shared building blocks listed; if one doesn't fit, extend it rather than writing a one-off.

**Loading & rendering**
- Pages are server components; DB reads happen inside `<Suspense>` after `await connection()` (Cache Components is on).
- Every `<Suspense>` gets a layout-shaped skeleton from `src/components/Skeleton.tsx` (`ListSkeleton`, `FormSkeleton`, `JobsSkeleton`, `ApplicationSkeleton`, `EditorSkeleton`, `AgentsSkeleton`) — never plain "Loading…" text. Add a new skeleton there if a page has a new shape.
- Run independent requests in parallel (`Promise.all`), never in sequence.
- Keep client components small; don't make a whole page `"use client"` to add one interactive widget.
- Avoid unnecessary re-renders: derive values instead of copying props into state; use `key` to reset state when server data changes (see `src/app/answers/page.tsx`).

**Data**
- **Every list query is paginated** with `pageFrom()`/`pageCount()` from `src/lib/paginate.ts` (50 per page) and rendered with `src/components/Pager.tsx`. No unbounded `select` that returns rows to a page or API.
- **Select only the columns you use.** No `db.select()` without a column map. Never load `jobs.raw`, `resumes.source_text` or large JSON for lists.
- **Index what you filter or sort on.** When adding a query with a new `where`/`orderBy`, add an index in `src/db/schema.ts` and run `npx drizzle-kit generate --name <what>`.
- No N+1: fetch related rows with a join or one `inArray` query, not a query per row.

**Network & duplicates**
- Every outside call has a timeout (`AbortSignal.timeout(...)`) and a clear error message.
- **Buttons that call the server use `useSingleFlight()`** from `src/lib/use-single-flight.ts` (ignores repeat clicks, gives `pending` for the busy state).
- **Server tasks that must not run twice at once use `singleFlight(key, fn)`** from `src/lib/single-flight.ts` (feed refresh, form planning, form filling per application).
- Debounce any input that calls the server while typing (≥300 ms). Client-side filtering doesn't need it.
- Update the UI optimistically for small, reversible actions (dismiss, delete, edit) and roll back with an error if the server fails (see `FeedList.tsx`, `AnswerLibrary.tsx`).

**Slow work & AI**
- Anything slower than ~2 s that the user doesn't need to wait for runs in the background and is wrapped in `track()` from `src/lib/activity.ts` so it shows on the Agents page.
- Text the user watches being generated is streamed token by token (`generateText(..., onToken)` in `src/lib/ai-text.ts`; see `src/app/api/ai-settings/test/route.ts`).

**Assets**
- Images: WebP (or AVIF) only, `loading="lazy"` + `decoding="async"` below the fold. Screenshots go through `saveScreenshot()` in `src/lib/apply/screenshot.ts`.
- Fonts via `next/font` only (self-hosted), at most 2 families and only the weights used.
- No third-party scripts; if one is ever needed, load it with `next/script` `strategy="lazyOnload"`.
- Don't add a dependency without checking it's needed; remove dependencies and files that become unused.

**Checks before finishing**
- `npx tsc --noEmit && npm run lint` clean; `npx next build` passes for larger changes.
- Not needed while ApplyKit runs locally for one user (revisit only if it's hosted for many users): CDN, Redis, load balancing/multiple instances, OpenTelemetry/RUM, DB connection-pool tuning beyond `postgres(url, { max: 5 })`.
