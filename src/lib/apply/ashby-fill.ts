import "server-only";
import { saveScreenshot } from "./screenshot";
import { trackedLog } from "@/lib/activity";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page, type Request } from "playwright";
import { ASHBY_FORM_QUERY, ashbyPathFor } from "@/lib/ats/ashby";
import type { Profile } from "@/lib/profile-schema";
import type { FillResult } from "./greenhouse-fill";
import type { PlannedAnswer } from "./types";

// Fills an Ashby application form in a headless (invisible) Chromium.
// Dry run: every non-GET request is blocked except Ashby's read-only `ApiJobPosting` GraphQL
// query, which the page needs to render the form. Nothing else (autosave, resume upload,
// location lookups, the submit mutation) reaches Ashby, and Submit is never clicked.

const SCREENSHOT_DIR = path.join(process.cwd(), ".data", "screenshots");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = (s: string) => new RegExp(`^\\s*${escapeRe(s.trim())}\\s*$`, "i");
const errText = (err: unknown) => (err instanceof Error ? err.message.split("\n")[0] : String(err));

/** True only for the read-only form query (POST body `operationName` + a `query`, never a mutation). */
function isFormQuery(req: Request) {
  if (!req.url().startsWith("https://jobs.ashbyhq.com/api/non-user-graphql")) return false;
  try {
    const body = JSON.parse(req.postData() ?? "") as { operationName?: string; query?: string };
    return body.operationName === ASHBY_FORM_QUERY && /^\s*query\s+ApiJobPosting\b/.test(body.query ?? "");
  } catch {
    return false;
  }
}

export async function fillAshby(opts: {
  applicationId: string;
  applyUrl: string;
  answers: PlannedAnswer[];
  profile: Profile;
  live: boolean;
}): Promise<FillResult> {
  const log = trackedLog();
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const screenshotPath = path.join(SCREENSHOT_DIR, `${opts.applicationId}.webp`);

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1600 }, locale: "en-US" });
    const page = await context.newPage();

    let blocked = 0;
    if (!opts.live) {
      await page.route("**/*", (route) => {
        const req = route.request();
        if (req.method() === "GET" || isFormQuery(req)) return route.continue();
        blocked++;
        return route.abort();
      });
    }

    await page.goto(opts.applyUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForSelector(".ashby-application-form-field-entry, [data-field-path]", { timeout: 20_000 });

    // Location last: in a dry run its suggestions never load, and the typed text only stays
    // visible while the input keeps focus.
    const ordered = [...opts.answers.filter((a) => a.kind !== "location"), ...opts.answers.filter((a) => a.kind === "location")];
    for (const a of ordered) {
      try {
        await fillOne(page, a, log, opts.live);
      } catch (err) {
        log.push(`✗ ${a.label}: ${errText(err)}`);
      }
    }

    // Required questions (label marked required) that still have no value.
    const emptyRequired = await page.$$eval("[data-field-path]", (entries) =>
      entries
        .filter((entry) => {
          const title = entry.querySelector(".ashby-application-form-question-title");
          if (!title || !/_required/.test(title.className)) return false;
          if (entry.querySelector('[aria-pressed="true"], input:checked')) return false;
          const file = entry.querySelector<HTMLInputElement>('input[type="file"]');
          if (file) return !file.files?.length && !/\.(pdf|docx?|txt|rtf|odt|md)\b/i.test(entry.textContent ?? "");
          const inputs = [...entry.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter(
            (i) => !["checkbox", "radio", "hidden"].includes(i.type),
          );
          return inputs.length === 0 || inputs.every((i) => !i.value.trim());
        })
        .map((entry) => entry.querySelector(".ashby-application-form-question-title")?.textContent?.trim() ?? ""),
    );
    if (emptyRequired.length) log.push(`⚠ Still empty: ${emptyRequired.map((l) => l.slice(0, 80)).join(", ")}`);

    if (!opts.live) {
      log.push(`Dry run: Submit not clicked; blocked ${blocked} outgoing request(s) so nothing was sent.`);
      await saveScreenshot(page, screenshotPath);
      return { outcome: "dry_run_done", log, screenshotPath };
    }

    // Live submit.
    await page.locator("button.ashby-application-form-submit-button").first().click();
    const result = await Promise.race([
      page
        .locator(".ashby-application-form-success-container")
        .or(page.getByText(/thank you for (applying|your application)|application (has been )?(submitted|received)|successfully submitted/i))
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "submitted" as const),
      page
        .locator('iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha.com"][src*="challenge"], iframe[title*="challenge" i]')
        .first()
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => "captcha" as const),
      page
        .getByText(/flagged as (possible )?spam|couldn.t verify you|verification (failed|code)/i)
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "spam" as const),
    ]).catch(() => "unknown" as const);
    await saveScreenshot(page, screenshotPath);

    if (result === "submitted") return { outcome: "submitted", log, screenshotPath };
    if (result === "captcha") return { outcome: "blocked", log, screenshotPath, error: "CAPTCHA challenge: needs you." };
    if (result === "spam") return { outcome: "blocked", log, screenshotPath, error: "Ashby flagged the submission for verification: needs you." };
    const errors = await page.locator(".ashby-application-form-field-entry [class*='error'], [class*='_error']").allTextContents().catch(() => []);
    const detail = errors.map((e) => e.trim()).filter(Boolean).slice(0, 3).join("; ");
    return { outcome: "failed", log, screenshotPath, error: `No confirmation after submitting; check the screenshot.${detail ? ` ${detail}` : ""}` };
  } catch (err) {
    return { outcome: "failed", log, screenshotPath, error: errText(err) };
  } finally {
    await browser.close();
  }
}

/** The question container for a FormField id (see ashbyFields for the id scheme). */
async function entryFor(page: Page, fieldId: string): Promise<Locator | null> {
  if (fieldId === "phone") {
    const tel = page.locator('[data-field-path]:has(input[type="tel"])').first();
    return (await tel.count()) ? tel : null;
  }
  const entry = page.locator(`[data-field-path="${ashbyPathFor(fieldId).replace(/"/g, '\\"')}"]`).first();
  return (await entry.count()) ? entry : null;
}

async function fillOne(page: Page, a: PlannedAnswer, log: string[], live: boolean) {
  const entry = await entryFor(page, a.fieldId);
  if (!entry) {
    log.push(`- ${a.label}: field not on page, skipped`);
    return;
  }
  await entry.scrollIntoViewIfNeeded();
  const value = a.value;
  switch (a.kind) {
    case "text":
    case "textarea": {
      const date = entry.locator("input.ashby-application-form-input-date, .react-datepicker__input-container input");
      if (await date.count()) {
        const formatted = toDateInput(String(value));
        await date.first().fill(formatted);
        await date.first().press("Enter");
        await page.keyboard.press("Escape");
        log.push(`✓ ${a.label}: ${formatted}`);
        return;
      }
      await entry.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea').first().fill(String(value));
      log.push(`✓ ${a.label}`);
      return;
    }
    case "file":
      await entry.locator('input[type="file"]').first().setInputFiles(String(value));
      log.push(`✓ ${a.label}: attached ${path.basename(String(value))}`);
      return;
    case "select":
      await choose(page, entry, String(value));
      log.push(`✓ ${a.label}: ${value}`);
      return;
    case "multiselect": {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) await choose(page, entry, v, true);
      log.push(`✓ ${a.label}: ${values.join(", ")}`);
      return;
    }
    case "location": {
      const input = entry.locator('input[role="combobox"], input').first();
      await input.click();
      await input.fill("");
      await input.pressSequentially(String(value), { delay: 40 });
      // Suggestions come from Ashby's location lookup, a POST that dry run blocks.
      const option = page.locator('[role="listbox"] [role="option"]').first();
      try {
        await option.waitFor({ timeout: live ? 8_000 : 3_000 });
        await option.click();
        log.push(`✓ ${a.label}: ${(await input.inputValue()) || value}`);
      } catch {
        log.push(
          live
            ? `⚠ ${a.label}: no location suggestion for "${value}"`
            : `⚠ ${a.label}: typed "${value}" (suggestions need a lookup request that dry run blocks; live run picks the first match)`,
        );
      }
      return;
    }
    default:
      log.push(`- ${a.label}: unsupported field type ${a.kind}`);
  }
}

/** Picks one option in whichever widget Ashby rendered: yes/no buttons, radios, checkboxes or a dropdown. */
async function choose(page: Page, entry: Locator, label: string, multi = false) {
  const yesNo = entry.locator("button.ashby-application-form-input-yesno-option");
  if (await yesNo.count()) {
    const btn = yesNo.filter({ hasText: exact(label) }).first();
    await btn.click();
    if ((await btn.getAttribute("aria-pressed")) !== "true") throw new Error(`"${label}" did not stay selected`);
    return;
  }

  const optionLabels = entry.locator(
    "label.ashby-application-form-input-radio-group-option-label, label.ashby-application-form-input-checkbox-group-option-label",
  );
  if (await optionLabels.count()) {
    const target = optionLabels.filter({ hasText: exact(label) }).first();
    if (!(await target.count())) throw new Error(`option "${label}" not found`);
    const input = entry.locator(`[id="${(await target.getAttribute("for"))?.replace(/"/g, '\\"')}"]`);
    if (multi && (await input.isChecked().catch(() => false))) return;
    await target.click();
    if (!(await input.isChecked().catch(() => true))) throw new Error(`"${label}" did not stay selected`);
    return;
  }

  // A lone checkbox (e.g. a Boolean rendered as "I agree").
  const single = entry.locator('input[type="checkbox"]');
  if ((await single.count()) === 1 && /^(yes|true)$/i.test(label)) {
    await single.check({ force: true });
    return;
  }

  // Dropdown / autocomplete.
  const combo = entry.locator('input[role="combobox"], input').first();
  await combo.click();
  await combo.fill("");
  await combo.pressSequentially(label.slice(0, 30), { delay: 20 });
  const option = page.locator('[role="listbox"] [role="option"]').filter({ hasText: exact(label) }).first();
  try {
    await option.waitFor({ timeout: 5_000 });
    await option.click();
  } catch {
    await page.keyboard.press("Escape");
    throw new Error(`option "${label}" not found`);
  }
}

/** Ashby's date picker takes MM/DD/YYYY. Accepts a date, or "2 weeks" / "1 month" / "immediately" from now. */
function toDateInput(value: string): string {
  const v = value.trim().toLowerCase();
  const d = new Date();
  const rel = v.match(/(\d+)\s*(day|week|month)/);
  if (rel) {
    const n = Number(rel[1]);
    if (rel[2] === "day") d.setDate(d.getDate() + n);
    else if (rel[2] === "week") d.setDate(d.getDate() + 7 * n);
    else d.setMonth(d.getMonth() + n);
  } else if (!/immediate|asap|now|today/.test(v)) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    d.setTime(parsed.getTime());
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}
