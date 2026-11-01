import "server-only";
import { saveScreenshot } from "./screenshot";
import { trackedLog } from "@/lib/activity";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import type { Profile } from "@/lib/profile-schema";
import type { FillResult } from "./greenhouse-fill";
import type { PlannedAnswer } from "./types";

// Fills a SmartRecruiters OneClick application (jobs.smartrecruiters.com/oneclick-ui/company/
// {company}/publication/{uuid}) in a headless Chromium.
// Dry run: every non-GET request is blocked. The OneClick app loads its config, translations
// and feature flags with GETs, so no exception is needed; DataDome's and Cloudflare's
// bot-check beacons, analytics, the resume upload/parse and the submit are all blocked, and
// no Next / Submit button is ever clicked.
// SmartRecruiters protects OneClick with DataDome. When it serves its "Access is temporarily
// restricted" / CAPTCHA page instead of the form, we stop with outcome "blocked" (never solved
// or bypassed) and the user applies themselves.
// Field ids are the standard ones from smartRecruitersFields (first_name, last_name, email,
// phone, location, resume); the fields are located by their accessible labels.

export type { FillResult };

const SCREENSHOT_DIR = path.join(process.cwd(), ".data", "screenshots");
const errText = (err: unknown) => (err instanceof Error ? err.message.split("\n")[0] : String(err));

const BOT_WALL = 'iframe[src*="captcha-delivery.com"], iframe[src*="hcaptcha.com"][src*="challenge"], iframe[src*="recaptcha/api2/bframe"]';
const BOT_TEXT = /access is temporarily restricted|unusual activity from your device|verify you are (a )?human/i;

// How each standard field shows up in OneClick: its <spl-*> component's inner input (Playwright's
// CSS pierces the open shadow DOM), then plain-input fallbacks, then the accessible label.
const FIELD: Record<string, { css: string; label: RegExp }> = {
  first_name: { css: '#first-name-input input, input#first-name-input, input[autocomplete="given-name"]', label: /^\s*first name/i },
  last_name: { css: '#last-name-input input, input#last-name-input, input[autocomplete="family-name"]', label: /^\s*last name/i },
  email: { css: '#email-input input, input#email-input', label: /^\s*e-?mail\b/i },
  phone: { css: '#phone-number-input input[type="tel"], input#phone-number-input, input[type="tel"]', label: /phone/i },
  location: { css: '#location-input input, input#location-input', label: /^\s*(city|location)/i },
};
const CONFIRM_EMAIL = { css: '#confirm-email-input input, input#confirm-email-input', label: /confirm.*e-?mail/i };

export async function fillSmartRecruiters(opts: {
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
        if (route.request().method() === "GET") return route.continue();
        blocked++;
        return route.abort();
      });
    }

    await page.goto(opts.applyUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Either the form (first-name input) or DataDome's wall appears.
    const firstName = field(page, FIELD.first_name);
    const state = await Promise.race([
      firstName.waitFor({ timeout: 30_000 }).then(() => "form" as const),
      page.locator(BOT_WALL).first().waitFor({ state: "attached", timeout: 30_000 }).then(() => "wall" as const),
      page.getByText(BOT_TEXT).first().waitFor({ timeout: 30_000 }).then(() => "wall" as const),
    ]).catch(() => "unknown" as const);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const wall = state === "wall" || (state === "unknown" && (await isWalled(page)));
    if (wall || state === "unknown") {
      await saveScreenshot(page, screenshotPath);
      if (!opts.live) log.push(`Dry run: Submit not clicked; blocked ${blocked} outgoing request(s) so nothing was sent.`);
      return {
        outcome: wall ? "blocked" : "failed",
        log,
        screenshotPath,
        error: wall
          ? "SmartRecruiters' bot protection (DataDome) showed a CAPTCHA / access block instead of the form: apply yourself."
          : "The SmartRecruiters application form did not load; check the screenshot.",
      };
    }

    await declineCookies(page);

    for (const a of opts.answers) {
      try {
        await fillOne(page, a, log);
      } catch (err) {
        log.push(`✗ ${a.label}: ${errText(err)}`);
      }
    }

    const emptyRequired = await stillEmpty(page);
    if (emptyRequired.length) log.push(`⚠ Still empty: ${emptyRequired.map((l) => l.slice(0, 80)).join(", ")}`);

    if (!opts.live) {
      log.push("Screening questions (if any) are on OneClick's next step, which a dry run does not open.");
      log.push(`Dry run: Submit not clicked; blocked ${blocked} outgoing request(s) so nothing was sent.`);
      await saveScreenshot(page, screenshotPath);
      return { outcome: "dry_run_done", log, screenshotPath };
    }

    // Live: OneClick's button is "Next" when screening questions follow, else "Submit"/"Apply".
    const button = page.getByRole("button", { name: /^\s*(next|submit|apply|send)\b/i }).last();
    const label = ((await button.textContent()) ?? "").trim();
    await button.click();
    const result = await Promise.race([
      page
        .getByText(/application (has been )?(sent|submitted|received)|thank(s| you) for (applying|your application)/i)
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "submitted" as const),
      page.locator(BOT_WALL).first().waitFor({ state: "attached", timeout: 45_000 }).then(() => "captcha" as const),
      page.getByText(BOT_TEXT).first().waitFor({ timeout: 45_000 }).then(() => "captcha" as const),
      page
        .locator('[aria-invalid="true"]:visible, .error-message:visible, [class*="error"]:visible:has-text("required")')
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "invalid" as const),
      ...(/^next/i.test(label)
        ? [page.getByText(/screening|questions/i).first().waitFor({ timeout: 45_000 }).then(() => "questions" as const)]
        : []),
    ]).catch(() => "unknown" as const);
    await saveScreenshot(page, screenshotPath);

    if (result === "submitted") return { outcome: "submitted", log, screenshotPath };
    if (result === "captcha") return { outcome: "blocked", log, screenshotPath, error: "SmartRecruiters showed a CAPTCHA (DataDome): needs you." };
    if (result === "questions") {
      return { outcome: "failed", log, screenshotPath, error: "SmartRecruiters asks screening questions on the next step; answer them yourself." };
    }
    if (result === "invalid") return { outcome: "failed", log, screenshotPath, error: "SmartRecruiters rejected the form. Check the screenshot." };
    return { outcome: "failed", log, screenshotPath, error: "No confirmation after submitting; check the screenshot." };
  } catch (err) {
    return { outcome: "failed", log, screenshotPath, error: errText(err) };
  } finally {
    await browser.close();
  }
}

async function isWalled(page: Page) {
  if (await page.locator(BOT_WALL).count()) return true;
  return BOT_TEXT.test((await page.locator("body").textContent().catch(() => "")) ?? "");
}

/** An input found by its id/attributes, else by its label (getByLabel also pierces shadow DOM). */
const field = (page: Page, f: { css: string; label: RegExp }): Locator => page.locator(f.css).or(page.getByLabel(f.label)).first();

async function fillOne(page: Page, a: PlannedAnswer, log: string[]) {
  const value = String(Array.isArray(a.value) ? a.value[0] : a.value);
  if (a.kind === "file") {
    // The first file input is "Easy Apply" (resume parsing); the Resume section's comes last.
    const files = page.locator('input[type="file"]');
    if (!(await files.count())) return void log.push(`- ${a.label}: field not on page, skipped`);
    const file = files.last();
    await file.setInputFiles(value);
    log.push(`✓ ${a.label}: attached ${path.basename(value)}`);
    await page.waitForTimeout(1_500);
    return;
  }
  const spec = FIELD[a.fieldId];
  if (!spec) return void log.push(`- ${a.label}: not a OneClick field, skipped`);
  const input = field(page, spec);
  if (!(await input.count())) return void log.push(`- ${a.label}: field not on page, skipped`);
  await input.scrollIntoViewIfNeeded();
  await input.fill("");
  if (a.kind === "location") {
    await input.pressSequentially(value, { delay: 40 });
    // Suggestions come from a location lookup; pick the first one if it shows up.
    const option = page.locator('[role="listbox"] [role="option"]').first();
    try {
      await option.waitFor({ timeout: 6_000 });
      await option.click();
      log.push(`✓ ${a.label}: ${(await input.inputValue().catch(() => "")) || value}`);
    } catch {
      log.push(`⚠ ${a.label}: typed "${value}" (no location suggestion appeared)`);
    }
    return;
  }
  await input.fill(value);
  log.push(`✓ ${a.label}`);
  if (a.fieldId === "email") {
    const confirm = field(page, CONFIRM_EMAIL);
    if (await confirm.count()) {
      await confirm.fill(value);
      log.push("✓ Confirm email");
    }
  }
}

/** OneTrust cookie banner: reject optional cookies. */
async function declineCookies(page: Page) {
  const reject = page.locator("#onetrust-reject-all-handler");
  if (await reject.isVisible().catch(() => false)) await reject.click().catch(() => {});
}

/** Labels of required inputs that are still empty after filling. */
async function stillEmpty(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[required], textarea[required], [aria-required="true"]').forEach((input) => {
      if (input.type === "hidden" || input.disabled || !("value" in input)) return;
      if (input.type === "file" ? (input as HTMLInputElement).files?.length : input.value.trim()) return;
      const label = (input.id && document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent) || input.getAttribute("aria-label") || input.name || input.id;
      out.push(label.replace(/\s+/g, " ").replace(/\*\s*$/, "").trim());
    });
    return [...new Set(out)];
  });
}
