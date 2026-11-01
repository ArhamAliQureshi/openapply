# ApplyKit audit — 2026-11-01

Scope: the whole app after it moved to `~/Desktop/personal/applykit`. Three read-only code audits (apply engine; security & open-source readiness; job feed & unfinished work) plus a hands-on check of the default AI models. Nothing was changed by the audit.

**Verdict: the core works, but it is not ready for live submissions or a public release.** Dry runs are safe. Before the first real application, the honesty bugs in §1 and the live-safety bugs in §2 must be fixed.

---

## 1. Honesty: wrong answers the app could submit (fix first)

| Sev | Where | Problem → example |
|---|---|---|
| critical | `src/lib/apply/plan.ts` sponsorship + "eligible" rules | Questions like *"Are you authorized to work in the US **without** sponsorship?"* get the opposite answer (they're answered from `needsSponsorship` or `authorized` alone). |
| critical | `plan.ts` `countryIn` + `src/lib/ats/lever.ts` location | Country detection: alias `"us"` matches the pronoun *us*; the US-state regex matches Lever country codes (`CA`=Canada, `DE`, `IN`…); `"america"` matches Latin America → US authorization used for UK/Canada/Germany/India jobs. |
| high | `plan.ts` `genericQuestionKey` + `service.ts saveAnswer` | Answers saved with the company name generalised get reused at other companies: "Why do you want to join Block?" essay reused for Kraken; "Do you know anyone at X?" reused. |
| high | `plan.ts` library lookup | Library key ignores the question description, so two different "Work Authorization" questions share one answer. |
| high | `plan.ts` past-employment rule | No word boundaries (`intern` matches *internet*); fires on text questions ("Which Stripe products have you worked with?" → "No"); only checks the first company named. |
| high | `plan.ts` attestation rule (when opted in) | "I understand this role requires clearance. Do you hold one?" → "Yes". Must only auto-agree when the options are agreement-only. |
| high | `plan.ts` clearance rule | "Do you have the ability to **obtain** a clearance?" → "No". |
| high | `src/lib/apply/ashby-fill.ts` lone checkbox | Planned "No" on a single checkbox can end up **ticked**. |
| high | `service.ts` AI fields | When a field has a description, the user's answer is saved under a key that's never looked up → the question stays "needs you" forever. |
| medium | `plan.ts` `pickOption` | Prefix matching maps "None"/"Not applicable" → "No" and "Yes - now" for booleans. |
| medium | profile defaults | `over18: true`, `willingToRelocate: false`, `howDidYouHear: "Company careers page"` silently answer questions the user never answered; "under 18?" → "Yes"; `source` regex hits "open source". |
| medium | `plan.ts` start-date rule + Ashby date | "Start date at your last employer?" gets the notice period; Ashby converts "2 weeks" to an invented date (and UTC date shift). |
| medium | AI answers | AI sees only About-me (not the resume), is regenerated on every replan (reviewed text ≠ submitted text), and live autopilot submits it unreviewed. |
| medium | `lever-fill.ts` | Signs the CC-305 disability form with the user's name without showing it in the plan. |

## 2. Live-submission safety

| Sev | Where | Problem |
|---|---|---|
| high | `service.ts runApplication` | No atomic claim: two runs (two tabs, or manual + autopilot) can both submit → **double application**. Use `UPDATE … WHERE status NOT IN ('filling','submitted') RETURNING`. |
| high | all fillers + autopilot | No confirmation after clicking submit is recorded as `failed`, which can be re-run live and doesn't count for the 30-day company skip. Add `submitted_unconfirmed`. |
| high | `greenhouse-fill.ts` | Confirmation/verification detection is page-wide text; job descriptions can contain "Thank you for applying" or "security code". Scope it. |
| medium | `service.ts` | Same job link can be planned and submitted twice (no per-job dedupe). Runs use the last saved plan (profile fixes not applied unless re-checked) → replan before live. |
| medium | fillers | Dry-run blocking is page-level: use `context.route`, `serviceWorkers: "block"`, WebSocket blocking; GET autocompletes still send typed text (reword the log). |
| medium | `ashby-fill.ts` | `press("Enter")` in date inputs could submit a form early (unverified). |
| low | `service.ts`, `instrumentation.ts`, autopilot | Rows can stick in `filling` after a crash; daily cap counts manual dry runs and uses server-local midnight; scheduler timers can duplicate on dev reload. |

## 3. Security (matters before anyone else runs it)

| Sev | Problem | Fix |
|---|---|---|
| high | No authentication and `next dev` listens on all interfaces — the app was reachable on the LAN (`192.168.x.x:3000`): profile, EEO answers, screenshots, autopilot. | Bind to `127.0.0.1` (`next dev -H 127.0.0.1`), add `src/proxy.ts` with a token when not on loopback. |
| high | CSRF: POST routes accept cross-site `text/plain`/form posts (swap resume, poison answers, start autopilot). | Check `Origin`/`Sec-Fetch-Site`, require JSON content-type or a custom header. |
| medium | `live: true` comes from the request body; README says live also needs Mode=Live. | Enforce server-side. |
| medium | Job descriptions go into AI prompts unescaped (prompt injection into answers). | Mark as untrusted data; review AI answers in live mode. |
| medium | Upload bodies read fully before the size check. | Check `content-length` first. |
| low | Absolute file paths stored in DB (a one-off path-fix script was needed when the folder moved); raw error messages returned; no magic-byte checks; old resume files never deleted. | Store paths relative to `.data/`, generic errors, cleanup. |

`npm audit --omit=dev`: **0 vulnerabilities**. 20 moderate dev-only (drizzle-kit/esbuild, eslint minimatch). No personal data in git history.

## 4. Default AI models

Current defaults (Settings page): resume reading `nvidia/nemotron-3.5-super-vl:free` (backups xing4.0, dots-3-note); written answers `nvidia/nemotron-3-ultra-550b-a55b:free` (backups Nemotron 3.5 Super, Nemotron 3 Nano).

Findings:
1. **The default resume model fails intermittently because it "thinks" first.** On the user's real resume it ran out of output tokens after 65 s. Diagnosis: 1,902 of 2,479 output tokens were hidden reasoning. With `reasoning: { effort: "none" }` the same model parsed the full resume correctly in **10 s** (6 jobs, 59 skills, 4 certs). **Fix: send `reasoning: { effort: "none" }` for resume reading** (only to models whose `supported_parameters` include `reasoning`, because `require_parameters: true` is set).
2. **Free-tier quota is tiny: 50 free-model requests/day** for accounts that never bought credits (OpenRouter docs; the key showed 23/50 used after testing). A **one-time $10 credit purchase raises it to 1,000/day** — still free models, no per-call cost. Recommended before using autopilot.
3. Free models are often rate-limited upstream (Gemma 4 free, xing4.0, Liquid were all rate-limited during testing). Keep 2+ backups; consider one cheap paid model as the last backup if reliability matters more than $0.
4. Written answers: Nemotron 3 Ultra gave the best answers (4–9 s); keep it. Nano uses clichés; Gemma 4 free is good but usually rate-limited.
5. Strict JSON is a property of the *host*: free Gemma 4 hosts can't enforce it (Ollama can, locally). The app now falls back to plain JSON mode for such models, but Nemotron 3.5 Super with strict JSON remains the right default.
6. Claude (`claude-opus-5-5`) remains wired but has no key; it's the most reliable option for applications that go to employers if budget allows.

**Verdict:** the defaults are the best *free* choices available today, **after** the reasoning fix in (1). Without $10 of credits, autopilot will hit the 50/day limit quickly.

## 5. Job feed and unfinished work

| Item | Verdict |
|---|---|
| Feed extension (Workable, SmartRecruiters, Recruitee, Personio, Workday) — `src/lib/feed/{types,sources,index,more-sources,http,text}.ts`, `companies.json`, `board-names.json` | **Merge after fixes.** Works: 37,940 jobs from 397 boards in ~164 s. But: autopilot picks jobs it has no filler for (must filter to `ADAPTERS`); Workable returned 429 for all boards; Recruitee custom-domain links don't parse; closed-job detection falsely closes jobs and never reopens them; 20 s timeout too short for big Greenhouse boards. |
| Fillers for Workable / SmartRecruiters / Recruitee | **Removed in the cleanup** (never wired in). Recover them from commit `5fb84b6` (`src/lib/ats/{workable,smartrecruiters,recruitee}.ts`, `src/lib/apply/*-fill.ts`, `sources.extra.ts`) when implementing. Original verdict: merge after fixes. Compile and are dry-run safe, but not wired into `ADAPTERS`; SmartRecruiters is blocked by bot protection (keep it manual); Recruitee consent field always "needs you". |
| YC boards — `src/lib/feed/yc-companies.json` (+ meta) | **Safe to merge** (one import + `merge()`), 93 verified boards. |
| Matching (`src/lib/feed/match.ts`) | Remote jobs restricted to other countries pass as "Remote" (Sweden, Brazil, India…); "intern" doesn't exclude "Internship"; UAE aliases missing (Ras Al Khaimah, GCC, MENA, EMEA); "wales" matches New South Wales. |
| UI text | Still says "250 companies", "Greenhouse, Lever, Ashby", "about a minute". |

## 6. Open-source release checklist

Status 2026-11-01: published at github.com/ArhamAliQureshi/openapply under MIT. Done: 1 (`!.env.example`), 2, 3 (README rewritten), 4 (LICENSE + package.json license; SECURITY.md/CI still open), 6 (example.com personas, template SVGs removed). Still open: 5 (localhost binding + auth/CSRF), 7 (rotate key), SECURITY.md, CI.

1. `.gitignore`: add `!.env.example` (it's currently ignored by `.env*`), plus `*.log`, `scripts/_*`.
2. Rewrite `.env.example` with every variable (`AI_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `ANTHROPIC_API_KEY`, `OLLAMA_*`, `DATABASE_URL`, `ALLOW_LIVE_SUBMIT=false`, `FEED_SOURCES`, `FEED_DISCOVERY`, `PORT`, auth token).
3. Rewrite README: Node ≥ 20.9, `npm install && npx playwright install chromium`, provider choice, supported ATS list, dry-run-first workflow, backup (`.data/`), "localhost only", data & privacy, responsible-use disclaimer (job-site terms, no CAPTCHA bypass, user is responsible for every submission).
4. Add `LICENSE` (MIT or Apache-2.0 — all dependencies are compatible) and `"license"` in package.json; `SECURITY.md`; optional CI (tsc, lint, `npm audit --omit=dev`).
5. Bind to 127.0.0.1 + auth/CSRF proxy (§3) before announcing.
6. Replace test personas' LinkedIn/GitHub URLs with `example.com`; remove create-next-app SVGs; remove unwired filler code (done).
7. Rotate the OpenRouter key that was pasted in chat.
8. Stage files explicitly for the first commit (never `git add -A` blindly); `.data/`, `.env.local`, `.claude/`, `.next/` must stay untracked.

## 7. Recommended order

1. Commit the current code (private) so fixes are reviewable.
2. Honesty fixes (§1) + live-safety fixes (§2) — with unit tests for `plan.ts` (pure functions, easy to test).
3. AI: reasoning-off for resume reading; show free-quota remaining on Settings; buy $10 credits (owner's decision).
4. Security (§3): localhost binding, CSRF, auth token.
5. Feed: merge YC list; fix matching; merge the 5 new sources with autopilot filtering by supported fillers.
6. First live application together (owner present).
7. Gmail (drafts for email-apply jobs, reply monitoring, verification codes).
8. Open-source release checklist (§6), then publish.
