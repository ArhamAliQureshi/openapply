# OpenApply

**A self-hosted, open-source job-application autopilot.** OpenApply finds jobs that match you on company career pages, works out the answer to every question on the application form, and fills the form in a hidden browser. It never invents an answer it doesn't know, and it never submits unless you turn that on.

> Status: **early alpha.** Form filling is tested in dry-run mode on real Greenhouse, Lever and Ashby jobs. Live submission works but is untested in the wild. Read [`AUDIT.md`](AUDIT.md) before relying on it.

---

## What it does

- **Finds jobs** daily from ~250 companies' public career pages (Greenhouse, Lever, Ashby APIs), scores each against your titles, locations and skills, and filters out the rest.
- **Reads the application form** of each job and plans an answer for every field, in this order:
  1. your **profile** (contact details, links, work authorization per country, salary, notice period…)
  2. your **answer library**, with every question you've answered before reused automatically
  3. safe **rules** (e.g. "Are you authorized to work in the US?" from your work-authorization settings; "I don't wish to answer" for optional diversity questions)
  4. **AI**, only for open-ended questions like *"Why do you want to work here?"*, written from your own background
  5. anything else → a **"needs you"** list. It never guesses facts.
- **Fills the form headlessly** (Playwright/Chromium). It never touches your own browser and saves a screenshot of every filled form.
- **Dry run by default**: in dry-run mode every outgoing request is blocked and Submit is never clicked, so nothing reaches the employer.
- **Autopilot**: once a day it refreshes jobs, plans and fills the best new matches up to a daily limit, and skips companies you applied to in the last 30 days.
- **Resume tools**: upload a PDF/DOCX resume, AI extracts it into structured data, then edit it and export a clean, ATS-friendly PDF.
- **Agents dashboard**: see live what's running (feed refreshes, form reading, form filling, AI calls).
- **AI settings page**: choose provider and model per task, with a live model list, free-model filter and a Test button.

## Supported

| | |
|---|---|
| **Application forms (auto-fill)** | Greenhouse, Lever, Ashby |
| **Job sources** | Greenhouse, Lever and Ashby public job-board APIs; Arbeitnow / The Muse / Remotive for discovering new companies |
| **AI providers** | [OpenRouter](https://openrouter.ai) (default, free models), [Ollama](https://ollama.com) (fully local), Claude (Anthropic API) |
| **Database** | Embedded Postgres ([PGlite](https://pglite.dev), zero setup) or any Postgres via `DATABASE_URL` |

Never supported, by design: LinkedIn, Indeed, Glassdoor, Google Jobs or other sites whose terms forbid automation; CAPTCHA or verification-code bypassing (those applications are marked "needs you").

## Quick start

Requirements: **Node.js 20.9+** and macOS, Linux or Windows.

```bash
git clone https://github.com/ArhamAliQureshi/openapply.git
cd openapply
npm install
npx playwright install chromium-headless-shell   # the hidden browser used to fill forms
cp .env.example .env.local                        # then add an OPENROUTER_API_KEY (free)
npm run dev
```

Open <http://localhost:3000>, then:

1. **Profile**: upload your resume (it pre-fills the profile), then complete work authorization, citizenship, salary and notice period.
2. **Settings**: pick AI models (defaults are free OpenRouter models) and press **Test**.
3. **Jobs**: enter target titles and locations, then **Refresh jobs**.
4. Click **Plan** on a job, answer any "needs you" questions once, then **Dry run** and check the screenshot.
5. When you trust it: set `ALLOW_LIVE_SUBMIT=true` in `.env.local`, restart, and switch the autopilot mode to **Live**.

> **Free-model limit:** OpenRouter allows 50 free-model requests/day on accounts that have never bought credits, or 1,000/day after a one-time $10 purchase. Each application can use one or two AI calls.

## How it works

```
career-page APIs ──► feed (filter + score) ──► autopilot ──► plan answers ──► headless fill ──► screenshot / submit
                                                   │              │
                                         daily limit, 30-day   profile → answer library → rules → AI → "needs you"
                                         company skip
```

| Area | Code |
|---|---|
| Answer planner (pure functions) | `src/lib/apply/plan.ts` |
| ATS readers and form fillers | `src/lib/ats/*`, `src/lib/apply/*-fill.ts`, registry in `src/lib/apply/sources.ts` |
| Job feed and matching | `src/lib/feed/*` |
| Autopilot and scheduler | `src/lib/apply/autopilot.ts`, `src/instrumentation.ts` |
| AI providers and settings | `src/lib/ai/*`, `src/lib/ai-text.ts`, `src/lib/parse-resume.ts` |
| Database schema and migrations | `src/db/schema.ts`, `drizzle/` |

Built with Next.js 16, React 19, Tailwind CSS 4, Drizzle ORM, Playwright and zod.

## Your data

- Everything is stored locally in `.data/` (database, your resume file, screenshots). Nothing is uploaded except:
  - your resume text and relevant profile facts, to the **AI provider you choose** (use Ollama to keep everything on your machine)
  - the form answers, to the **employer's application form**, and only in live mode
- Back up by copying `.data/` while the app is stopped.
- **Run it on your own machine only.** There is no login yet; don't expose it to a network you don't control (see `AUDIT.md`).

## Responsible use

You are responsible for every application sent in your name. Check dry-run screenshots before enabling live mode, keep the daily limit reasonable, and make sure your use complies with the terms of the sites and hiring platforms involved. OpenApply identifies itself honestly, never bypasses CAPTCHAs or verification steps, defaults diversity questions to "I don't wish to answer", and leaves legal attestations (e.g. arbitration agreements) to you unless you opt in.

## Development

```bash
npx tsc --noEmit && npm run lint      # must stay clean
npx next build                        # full compile
```

Dev scripts run without the web server (stop `npm run dev` first; the embedded database allows one process):

```bash
npx tsx --env-file=.env.local --conditions=react-server scripts/dry-run.mts <job-url>
npx tsx --env-file=.env.local --conditions=react-server scripts/autopilot-test.mts 5
npx tsx --conditions=react-server scripts/feed-test.mts
```

Contributors and coding agents: read [`AGENTS.md`](AGENTS.md) (project rules, including **performance rules**) and [`AUDIT.md`](AUDIT.md) (known issues and priorities). Run `npm run knip` to check for unused files, exports and dependencies.

## Roadmap

- Fix the honesty and live-safety issues listed in `AUDIT.md`
- Localhost-only binding, auth and CSRF protection
- More platforms: auto-fill for Workable, SmartRecruiters and Recruitee (their jobs already appear in the feed for manual apply); Personio and Workday (discovery only)
- Gmail: drafts for apply-by-email jobs, reply tracking, verification codes
- Mock interviews and ATS resume checks

## License

[MIT](LICENSE) © 2026 Arham Ali Qureshi
