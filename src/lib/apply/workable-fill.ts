import "server-only";
import { saveScreenshot } from "./screenshot";
import { trackedLog } from "@/lib/activity";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import { workableDomName } from "@/lib/ats/workable";
import type { Profile } from "@/lib/profile-schema";
import type { FillResult } from "./greenhouse-fill";
import type { PlannedAnswer } from "./types";

// Fills a Workable application form (apply.workable.com/{account}/j/{shortcode}/apply/) in a
// headless Chromium. Dry run: every non-GET request is blocked. The form renders from GETs
// alone (the page, its JS chunks and the read-only /api/v1/jobs/{shortcode}/form JSON), so no
// exception is needed: Cloudflare's bot-check beacon, analytics, the resume upload and the
// submit POST are all blocked, and Submit is never clicked.
// The resume upload (a POST straight to Workable's S3 bucket) is answered locally with an empty
// "204 No Content" instead of being aborted: the file never leaves the machine, but Workable's
// app crashes to an error page when that upload fails.
// Field ids are the inputs' `name`s (standard ones renamed, see workableDomName).

export type { FillResult };

const SCREENSHOT_DIR = path.join(process.cwd(), ".data", "screenshots");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = (s: string) => new RegExp(`^\\s*${escapeRe(s.trim())}\\s*$`, "i");
const css = (s: string) => s.replace(/"/g, '\\"');
const S3_UPLOAD = /^[a-z0-9.-]+\.s3[.-]([a-z0-9-]+\.)?amazonaws\.com$/i;
const errText = (err: unknown) => (err instanceof Error ? err.message.split("\n")[0] : String(err));

export async function fillWorkable(opts: {
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
        if (req.method() === "GET") return route.continue();
        blocked++;
        if (S3_UPLOAD.test(new URL(req.url()).hostname)) {
          return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" }, body: "" });
        }
        return route.abort();
      });
    }

    await page.goto(opts.applyUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const form = page.locator('form:has([name="email"])').first();
    const loaded = await form.waitFor({ timeout: 30_000 }).then(() => true, () => false);
    if (!loaded) {
      await saveScreenshot(page, screenshotPath);
      const title = await page.title().catch(() => "");
      return {
        outcome: "failed",
        log,
        screenshotPath,
        error: /429/.test(title) ? "Workable is rate-limiting requests; try again in a few minutes." : "The Workable application form did not load; check the screenshot.",
      };
    }
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Cookie banner: decline optional cookies (it also covers part of the form in the screenshot).
    const decline = page.locator('[data-ui="cookie-consent-decline"]');
    if (await decline.isVisible().catch(() => false)) await decline.click().catch(() => {});

    // Phone country prefix (Workable guesses it from the visitor's IP).
    const phoneCountry = opts.profile.phoneCountry || opts.profile.country;
    if (phoneCountry && opts.answers.some((a) => a.fieldId === "phone")) {
      await choosePhoneCountry(page, form, phoneCountry, log).catch((err) => log.push(`⚠ Phone country: ${errText(err)}`));
    }

    // Resume first: Workable may parse it and prefill fields, which our answers then overwrite.
    const ordered = [...opts.answers].sort((a, b) => Number(b.fieldId === "resume") - Number(a.fieldId === "resume"));
    for (const a of ordered) {
      try {
        await fillOne(page, form, a, log);
        if (a.fieldId === "resume") await page.waitForTimeout(1_500);
      } catch (err) {
        log.push(`✗ ${a.label}: ${errText(err)}`);
      }
    }

    const emptyRequired = await stillEmpty(form);
    if (emptyRequired.length) log.push(`⚠ Still empty: ${emptyRequired.map((l) => l.slice(0, 80)).join(", ")}`);

    if (!opts.live) {
      log.push(`Dry run: Submit not clicked; blocked ${blocked} outgoing request(s) so nothing was sent.`);
      await saveScreenshot(page, screenshotPath);
      return { outcome: "dry_run_done", log, screenshotPath };
    }

    // Live submit. Workable runs Cloudflare Turnstile; if it shows an interactive challenge we
    // stop and hand over to the user (never solved or bypassed).
    await form.locator('button[data-ui="apply-button"], button[type="submit"]').first().click();
    const result = await Promise.race([
      page
        .waitForURL(/\/(confirmation|thank-?you|success)/i, { timeout: 45_000 })
        .then(() => "submitted" as const),
      page
        .getByText(/application (has been )?(submitted|received|sent)|thank(s| you) for (applying|your application)/i)
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "submitted" as const),
      page
        .locator('iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"][src*="challenge"], iframe[src*="recaptcha/api2/bframe"]')
        .first()
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => "captcha" as const),
      page
        .locator('[data-ui$="error"]:visible, [role="alert"]:visible, [aria-invalid="true"]:visible')
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "invalid" as const),
    ]).catch(() => "unknown" as const);
    await saveScreenshot(page, screenshotPath);

    if (result === "submitted") return { outcome: "submitted", log, screenshotPath };
    if (result === "captcha") return { outcome: "blocked", log, screenshotPath, error: "Workable showed a CAPTCHA (Cloudflare Turnstile) challenge: needs you." };
    if (result === "invalid") {
      const msgs = await page.locator('[data-ui$="error"]:visible, [role="alert"]:visible').allTextContents().catch(() => []);
      const detail = msgs.map((m) => m.trim()).filter(Boolean).slice(0, 3).join("; ");
      return { outcome: "failed", log, screenshotPath, error: `Workable rejected the form${detail ? `: ${detail}` : ""}. Check the screenshot.` };
    }
    return { outcome: "failed", log, screenshotPath, error: "No confirmation after submitting; check the screenshot." };
  } catch (err) {
    return { outcome: "failed", log, screenshotPath, error: errText(err) };
  } finally {
    await browser.close();
  }
}

async function fillOne(page: Page, form: Locator, a: PlannedAnswer, log: string[]) {
  const name = workableDomName(a.fieldId);
  const value = a.value;

  if (a.kind === "file") {
    const file = form.locator(`input[type="file"][data-ui="${css(name)}"], [data-ui="${css(name)}"] input[type="file"]`).first();
    if (!(await file.count())) return void log.push(`- ${a.label}: field not on page, skipped`);
    await file.setInputFiles(String(value));
    log.push(`✓ ${a.label}: attached ${path.basename(String(value))}`);
    return;
  }

  // Consent checkbox (e.g. "gdpr"): a styled role=checkbox around a hidden input.
  const checkbox = form.locator(`input[type="checkbox"][name="${css(name)}"]`);
  if ((await checkbox.count()) === 1 && (a.kind === "select" || a.kind === "multiselect")) {
    const want = /^(yes|true|i agree|agree|accept)/i.test(String(Array.isArray(value) ? value[0] : value));
    if (want && !(await checkbox.isChecked())) {
      await form.locator(`label:has(input[type="checkbox"][name="${css(name)}"])`).first().click();
    }
    log.push(`✓ ${a.label.slice(0, 60)}: ${want ? "checked" : "left unchecked"}`);
    return;
  }

  // Yes/no questions render as radios (value "true"/"false") inside styled options.
  const radios = form.locator(`input[type="radio"][name="${css(name)}"]`);
  if (await radios.count()) {
    const want = String(Array.isArray(value) ? value[0] : value);
    const boolValue = /^yes\b/i.test(want) ? "true" : /^no\b/i.test(want) ? "false" : null;
    const values = await radios.evaluateAll((list) => list.map((e) => (e as HTMLInputElement).value));
    let i = boolValue ? values.indexOf(boolValue) : -1;
    if (i < 0) {
      // Option radios: match the visible option text.
      const texts = await radios.evaluateAll((list) => list.map((e) => e.closest("label")?.textContent?.trim() ?? ""));
      i = texts.findIndex((t) => exact(want).test(t));
    }
    if (i < 0) throw new Error(`option "${want}" not found`);
    await form.locator(`label:has(> input[type="radio"][name="${css(name)}"])`).nth(i).click();
    if (!(await radios.nth(i).isChecked())) throw new Error(`"${want}" did not stay selected`);
    log.push(`✓ ${a.label.slice(0, 80)}: ${want}`);
    return;
  }

  // Dropdowns: a read-only combobox with a listbox of options.
  const combo = form.locator(`[id="input_${css(name)}_input"]`);
  if (await combo.count()) {
    const values = Array.isArray(value) ? value : [String(value)];
    for (const v of values) {
      await combo.click();
      const option = page.locator(`[id="input_${css(name)}_listbox"] [role="option"]`).filter({ hasText: exact(v) }).first();
      try {
        await option.waitFor({ timeout: 5_000 });
        await option.click();
      } catch {
        await page.keyboard.press("Escape");
        throw new Error(`option "${v}" not found`);
      }
    }
    log.push(`✓ ${a.label.slice(0, 80)}: ${values.join(", ")}`);
    return;
  }

  // Checkbox lists ("multiple"): click each option's label inside the question.
  const group = form.locator(`[data-ui="${css(name)}"]`).first();
  if ((await group.count()) && (await group.locator('input[type="checkbox"]').count())) {
    const values = Array.isArray(value) ? value : [String(value)];
    for (const v of values) {
      const label = group.locator("label").filter({ hasText: exact(v) }).first();
      if (!(await label.count())) throw new Error(`option "${v}" not found`);
      await label.click();
    }
    log.push(`✓ ${a.label.slice(0, 80)}: ${values.join(", ")}`);
    return;
  }

  // Text, paragraph, number, date, phone.
  const input = form.locator(`input[name="${css(name)}"]:not([type="hidden"]):not([aria-hidden="true"]), textarea[name="${css(name)}"]`).first();
  if (!(await input.count())) return void log.push(`- ${a.label}: field not on page, skipped`);
  await input.scrollIntoViewIfNeeded();
  await input.fill(String(value));
  if (a.fieldId === "location") await page.keyboard.press("Escape").catch(() => {});
  log.push(`✓ ${a.label.slice(0, 80)}`);
}

/** Picks the phone country in Workable's intl-tel-input dropdown. */
async function choosePhoneCountry(page: Page, form: Locator, country: string, log: string[]) {
  const button = form.locator("button.iti__selected-country").first();
  if (!(await button.count())) return;
  if (new RegExp(`currently selected ${escapeRe(country)}\\b`, "i").test((await button.getAttribute("aria-label")) ?? "")) return;
  await button.click();
  const search = page.locator(".iti__search-input:visible").first();
  if (await search.count()) await search.fill(country);
  const option = page.locator(".iti__country:visible").filter({ has: page.locator(".iti__country-name", { hasText: new RegExp(`^${escapeRe(country)}`, "i") }) }).first();
  try {
    await option.waitFor({ timeout: 5_000 });
    await option.click();
    log.push(`✓ Phone country: ${country}`);
  } catch {
    await page.keyboard.press("Escape");
    throw new Error(`"${country}" not in the country list`);
  }
}

/** Labels of required questions that are still empty after filling. */
async function stillEmpty(form: Locator) {
  return form.evaluate((el) => {
    const out: string[] = [];
    const seen = new Set<string>();
    el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[required], [aria-required="true"]').forEach((input) => {
      const name = input.getAttribute("name") ?? input.getAttribute("data-ui") ?? input.id;
      // Only real form controls (Workable also marks styled wrappers aria-required).
      if (!name || seen.has(name) || input.disabled || typeof input.value !== "string") return;
      seen.add(name);
      let filled: boolean;
      // An uploaded file shows as a named chip in the dropzone (the input itself may be reset).
      if (input.type === "file")
        filled =
          Boolean((input as HTMLInputElement).files?.length) ||
          /\.(pdf|docx?|odt|rtf)\b/i.test(input.closest('[data-role="dropzone"]')?.textContent ?? "");
      else if (input.type === "radio" || input.type === "checkbox")
        filled = el.querySelectorAll(`[name="${CSS.escape(name)}"]:checked`).length > 0;
      else filled = Boolean(input.value.trim());
      if (filled) return;
      // Radios are labelled by their fieldset; text inputs by themselves.
      const labelled = input.hasAttribute("aria-labelledby") ? input : input.closest("[aria-labelledby]");
      const labelId = labelled?.getAttribute("aria-labelledby")?.split(" ")[0];
      const label = (labelId && document.getElementById(labelId)?.textContent) || name;
      out.push(label.replace(/\s+/g, " ").trim());
    });
    return out;
  });
}
