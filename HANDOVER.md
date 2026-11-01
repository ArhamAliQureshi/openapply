# Handover prompt

Copy everything below the line into a new agent session opened in this folder.

---

You are taking over development of **OpenApply** (the code still uses the working name "ApplyKit"), a self-hosted, open-source app that finds matching jobs and fills job application forms automatically in a hidden (headless) browser. You are working in this repository's root folder. The owner wants it close to 100% automated, but honest and safe.

## Read first
1. `AGENTS.md` (also loaded via `CLAUDE.md`) — **this is Next.js 16 with breaking changes**, and it holds the project's **performance rules** (skeletons, pagination, column selection, indexes, single-flight, timeouts, streaming, WebP). Follow them for all new code. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next code (async `params`, Cache Components are ON so DB reads go inside `<Suspense>` after `await connection()`, `proxy.ts` replaces middleware, `RouteContext`/`PageProps` global types via `npx next typegen`).
2. `AUDIT.md` — the full audit with prioritised findings. **Your work queue starts there.**
3. `README.md` — features and dev scripts (out of date in places; see AUDIT §6).

## How the owner wants to work
- **Explain what you understood, the plan, and what will be delivered before writing code**, then work one step at a time. Keep messages plain and short; the owner is not reading code.
- Keep a visible task list and report honestly: what's tested, what isn't.
- Default to **free OpenRouter models**. Privacy is not a concern for this project.
- **Never use the owner's visible browser** for applying; everything runs headless.
- Email-based applications: create **Gmail drafts** for the owner to send; never send email.
- Parallel sub-agents are welcome for independent work, but give each its own files, and never let them touch the database or submit anything.

## Hard rules
- **Never submit a real application** unless the owner explicitly asks for that specific live run. Dry runs block every non-GET request and never click Submit — keep it that way.
- **Never invent answers.** Anything not known from the profile, the answer library or a safe rule goes to "needs you". The AI may only write open-ended answers (motivation/experience), never facts.
- **Never bypass CAPTCHAs or verification codes.** Mark them "blocked / needs you".
- No scraping of LinkedIn, Indeed, Google, Glassdoor, hiring.cafe or ycombinator.com (terms forbid it). Use ATS public APIs.
- Don't commit or push unless asked. Don't put secrets in code or chat output.

## Stack and layout
- Next.js 16 (App Router, Turbopack, Cache Components), React 19, Tailwind 4, TypeScript, zod 4.
- DB: Drizzle ORM. **Embedded PGlite** (Postgres in WASM) in `.data/pglite` unless `DATABASE_URL` is set. Migrations in `drizzle/` run on boot (`npx drizzle-kit generate --name x` after editing `src/db/schema.ts`). PGlite allows **one process**: stop the dev server before running scripts that open the DB.
- Headless browser: Playwright 1.63 (`npx playwright install chromium-headless-shell` on a new machine).
- AI: `src/lib/ai/` — providers `openrouter` (default), `ollama` (local), `claude` (Anthropic SDK, `claude-opus-5-5`). Per-task choice (resume reading / written answers) stored in DB `app_state["ai"]`, edited on `/settings`. Keys only in `.env.local` (`OPENROUTER_API_KEY`, optional `ANTHROPIC_API_KEY`).

Key code:
| Area | Files |
|---|---|
| Resume parsing | `src/lib/parse-resume.ts`, `src/lib/clean-resume.ts`, `src/lib/resume-schema.ts` |
| Profile / answers | `src/lib/profile-schema.ts`, `src/app/profile`, `src/app/answers` |
| Answer planner | `src/lib/apply/plan.ts` (pure; best place to add unit tests) |
| Apply service | `src/lib/apply/service.ts`, `src/lib/apply/sources.ts` (adapter registry) |
| ATS readers / fillers | `src/lib/ats/{greenhouse,lever,ashby}.ts`, `src/lib/apply/{greenhouse,lever,ashby}-fill.ts` (wired); `workable/smartrecruiters/recruitee` + `sources.extra.ts` (NOT wired) |
| Feed | `src/lib/feed/*` (collectors, `match.ts` scoring, `run.ts` storage), `companies.json`, `yc-companies.json` (not merged) |
| Autopilot | `src/lib/apply/autopilot.ts`, `src/instrumentation.ts` (hourly tick → `/api/autopilot/tick`), `/jobs` page |
| Agents dashboard | `src/lib/activity.ts` (`track()`/`step()`), `/agents` |
| Pages | `/jobs`, `/apply`, `/apply/[id]`, `/profile`, `/answers`, `/` (resumes), `/agents`, `/settings` |

## Run and test
- Dev server: `npm run dev` (port **3000** — the autopilot scheduler expects it). The Claude desktop launch config pipes logs to `.data/dev.log`.
- Checks: `npx tsc --noEmit && npm run lint` (must stay clean); `npx next build` for a full compile.
- Dev scripts (server stopped): `npx tsx --env-file=.env.local --conditions=react-server scripts/<name>.mts` — `dry-run.mts <job-url>`, `autopilot-test.mts`, `missing-report.mts`, `replan-all.mts`, `feed-test.mts` (no DB), `*-dry-run.mts` (no DB, fake profile), `reset-data.mts --yes` (deletes all personal data — only on request).
- The owner's real profile and resume are in the DB/`.data/files`. Don't print their contents; report counts.

## Gotchas learned the hard way
- Turbopack sometimes keeps **stale server code** after edits to shared modules; if behaviour doesn't change, restart the dev server.
- `tsx` injects `__name()` into named functions inside `page.evaluate` callbacks → avoid named helpers inside browser callbacks.
- In-memory state shared across routes must live on `globalThis` (Next may load each route as a separate module instance).
- Small/free models loop on JSON: arrays are capped (`ARRAY_CAPS` in parse-resume.ts), output is validated with zod, then `cleanResume` removes repeats/invented skills.
- **OpenRouter free tier = 50 requests/day** until $10 of credits are bought once (then 1,000/day). Check usage: `GET https://openrouter.ai/api/v1/key`.
- Nemotron free models spend output on hidden reasoning → send `reasoning: { effort: "none" }` for resume reading (AUDIT §4).
- Greenhouse publishes each job's full form via `boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}?questions=true`; DOM ids equal field names; dropdowns are react-select (`[id^="react-select-{id}-option"]`); the EEOC "Race" question renders "Are you Hispanic/Latino?" first.
- Ashby's form comes from the read-only GraphQL `ApiJobPosting` query (the only POST allowed in dry run).
- Bytez was evaluated and removed (their API returned "model does not exist" for everything).

## Current state (2026-11-01)
Done and dry-run tested: resume parsing/editor/PDF; profile + answer library; Greenhouse/Lever/Ashby planning and filling (Discord, Figma, Zoox, Palantir, Spotify, OpenAI, Notion); job feed (~250 boards, Greenhouse/Lever/Ashby wired); autopilot with daily cap; AI settings page; agents dashboard.
Not done: everything in AUDIT.md §1–§3; merging the YC boards and 5 extra feed sources/3 fillers (AUDIT §5); first live submission (owner present); Gmail (drafts for email applications, reply monitoring, Greenhouse verification codes); mock interview / ATS check; open-source release prep (AUDIT §6); first real git commit (only the create-next-app commit exists).

## Your first task
Follow AUDIT.md §7. Start by proposing to the owner: (1) a private commit of the current code, then (2) the honesty fixes in §1 with unit tests for `plan.ts`. Explain the plan in a few lines and wait for a yes before coding.
