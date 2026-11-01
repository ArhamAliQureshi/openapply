import "server-only";
import { saveScreenshot } from "./screenshot";
import { trackedLog } from "@/lib/activity";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type { Profile } from "@/lib/profile-schema";
import type { PlannedAnswer } from "./types";

// Fills a Greenhouse application form in a headless (invisible) Chromium.
// Dry run: every non-GET request from the page is blocked, so nothing (not even the
// resume upload) reaches the employer, and Submit is never clicked.

export type FillResult = {
  outcome: "dry_run_done" | "submitted" | "blocked" | "failed";
  log: string[];
  screenshotPath: string;
  error?: string;
};

const SCREENSHOT_DIR = path.join(process.cwd(), ".data", "screenshots");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byId = (id: string) => `[id="${id.replace(/"/g, '\\"')}"]`;

export async function fillGreenhouse(opts: {
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

    await page.goto(opts.applyUrl, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForSelector("form", { timeout: 20_000 });

    // Phone country prefix (a Greenhouse UI field not listed in the API).
    if (opts.profile.phoneCountry && (await page.locator("#country").count())) {
      await chooseOption(page, "country", opts.profile.phoneCountry, "Phone country", log, true);
    }

    for (const a of opts.answers) {
      try {
        await fillOne(page, a, log);
      } catch (err) {
        log.push(`✗ ${a.label}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      }
    }

    // Required fields that are still empty after filling. Dropdowns keep their typed-text input
    // empty and show the choice in a separate element, so check that element instead.
    const emptyRequired = await page.$$eval("form input[id], form textarea[id]", (els) =>
      els
        .filter((e) => {
          const input = e as HTMLInputElement;
          if (input.type === "file" || input.type === "search" || input.type === "hidden") return false;
          const label = document.querySelector(`label[for="${CSS.escape(input.id)}"], #${CSS.escape(input.id)}-label`);
          const required = input.getAttribute("aria-required") === "true" || /\*\s*$/.test(label?.textContent ?? "");
          if (!required) return false;
          if (input.getAttribute("role") === "combobox") {
            const control = input.closest('[class*="control"]');
            return !control?.querySelector('[class*="single-value"], [class*="multi-value"]');
          }
          return !input.value;
        })
        .map((e) => (document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent ?? e.id).replace(/\*\s*$/, "").trim()),
    );
    if (emptyRequired.length) log.push(`⚠ Still empty: ${emptyRequired.join(", ")}`);

    if (!opts.live) {
      log.push(`Dry run: Submit not clicked; blocked ${blocked} outgoing request(s) so nothing was sent.`);
      await saveScreenshot(page, screenshotPath);
      return { outcome: "dry_run_done", log, screenshotPath };
    }

    // Live submit.
    await page.getByRole("button", { name: /submit application/i }).click();
    const result = await Promise.race([
      page
        .getByText(/thank you for applying|application (has been )?(submitted|received)|we.ve received your application/i)
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "submitted" as const),
      page
        .locator('iframe[src*="recaptcha/api2/bframe"], iframe[title*="challenge" i]')
        .first()
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => "captcha" as const),
      page
        .getByText(/security code|verification code/i)
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "code" as const),
    ]).catch(() => "unknown" as const);
    await saveScreenshot(page, screenshotPath);

    if (result === "submitted") return { outcome: "submitted", log, screenshotPath };
    if (result === "captcha") return { outcome: "blocked", log, screenshotPath, error: "CAPTCHA challenge: needs you." };
    if (result === "code") return { outcome: "blocked", log, screenshotPath, error: "Greenhouse emailed a verification code: needs you." };
    return { outcome: "failed", log, screenshotPath, error: "No confirmation after submitting; check the screenshot." };
  } catch (err) {
    return { outcome: "failed", log, screenshotPath, error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  } finally {
    await browser.close();
  }
}

// API field names that render under a different DOM id.
const DOM_ID: Record<string, string> = { location: "candidate-location" };

async function fillOne(page: Page, a: PlannedAnswer, log: string[]) {
  const domId = DOM_ID[a.fieldId] ?? a.fieldId;
  const el = page.locator(byId(domId));
  if (!(await el.count())) {
    log.push(`- ${a.label}: field not on page, skipped`);
    return;
  }
  switch (a.kind) {
    case "text":
    case "textarea":
      await el.fill(String(a.value));
      log.push(`✓ ${a.label}`);
      return;
    case "file":
      await el.setInputFiles(String(a.value));
      log.push(`✓ ${a.label}: attached ${path.basename(String(a.value))}`);
      return;
    case "select":
      await chooseOption(page, domId, String(a.value), a.label, log);
      return;
    case "multiselect":
      for (const v of a.value as string[]) await chooseOption(page, domId, v, a.label, log);
      return;
    case "location": {
      await el.click();
      await el.pressSequentially(String(a.value), { delay: 40 });
      const first = page.locator(`[id^="react-select-${domId}-option"]`).first();
      try {
        await first.waitFor({ timeout: 8_000 });
        await first.click();
        log.push(`✓ ${a.label}`);
      } catch {
        await page.keyboard.press("Escape");
        log.push(`⚠ ${a.label}: no location suggestion for "${a.value}"`);
      }
      return;
    }
    default:
      log.push(`- ${a.label}: unsupported field type ${a.kind}`);
  }
}

/** Opens a react-select dropdown and clicks the option with the given label. */
async function chooseOption(page: Page, fieldId: string, label: string, question: string, log: string[], prefix = false) {
  const input = page.locator(byId(fieldId));
  await input.click();
  await input.pressSequentially(label.slice(0, 30), { delay: 20 });
  // Options of *this* dropdown only (the page also contains a hidden phone-country list).
  const options = page.locator(`[id^="react-select-${fieldId}-option"]`);
  const pattern = prefix ? new RegExp(`^${escapeRe(label)}`, "i") : new RegExp(`^\\s*${escapeRe(label)}\\s*$`, "i");
  const match = options.filter({ hasText: pattern }).first();
  try {
    await match.waitFor({ timeout: 5_000 });
    await match.click();
    log.push(`✓ ${question}: ${label}`);
  } catch {
    await page.keyboard.press("Escape");
    throw new Error(`option "${label}" not found`);
  }
}
