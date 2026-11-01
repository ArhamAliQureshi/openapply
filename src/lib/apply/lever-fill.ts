import "server-only";
import { saveScreenshot } from "./screenshot";
import { trackedLog } from "@/lib/activity";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import type { Profile } from "@/lib/profile-schema";
import type { FillResult } from "./greenhouse-fill";
import type { PlannedAnswer } from "./types";

// Fills a Lever application form (jobs.lever.co/{company}/{id}/apply) in a headless Chromium.
// Dry run: every non-GET request from the page is blocked, so nothing (not even the resume
// upload or resume parsing) reaches Lever or the employer, and Submit is never clicked.
// Field ids are the inputs' `name` attributes (see leverFields).

export type { FillResult };

const SCREENSHOT_DIR = path.join(process.cwd(), ".data", "screenshots");
const byName = (name: string) => `form#application-form [name="${name.replace(/"/g, '\\"')}"]`;
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export async function fillLever(opts: {
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
    await page.waitForSelector("form#application-form", { timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    // Resume first: Lever parses it and may prefill name/email/etc., which our answers then overwrite.
    const ordered = [...opts.answers].sort((a, b) => Number(b.kind === "file") - Number(a.kind === "file"));
    for (const a of ordered) {
      try {
        await fillOne(page, a, log);
        if (a.kind === "file") await waitForResumeParse(page);
        if (a.fieldId === "eeo[disability]") await signDisabilityForm(page, opts.profile, log);
      } catch (err) {
        log.push(`✗ ${a.label}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
      }
    }

    const emptyRequired = await stillEmpty(page);
    if (emptyRequired.length) log.push(`⚠ Still empty: ${emptyRequired.join(", ")}`);

    if (!opts.live) {
      log.push(`Dry run: Submit not clicked; blocked ${blocked} outgoing request(s) so nothing was sent.`);
      await saveScreenshot(page, screenshotPath);
      return { outcome: "dry_run_done", log, screenshotPath };
    }

    // Live submit. Lever runs an invisible hCaptcha on submit; if it decides to show a
    // challenge we stop and hand over to the user (never solved or bypassed).
    await page.locator("#btn-submit, button[data-qa='btn-submit']").first().click();
    const result = await Promise.race([
      page
        .waitForURL(/\/thanks\/?(\?|$)/, { timeout: 45_000 })
        .then(() => "submitted" as const),
      page
        .getByText(/application submitted|thanks for applying|thank you for applying|we.ve received your application/i)
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "submitted" as const),
      page
        .locator('iframe[src*="hcaptcha.com"][title*="challenge" i], iframe[src*="recaptcha/api2/bframe"]')
        .first()
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => "captcha" as const),
      page
        .locator(".application-error:visible, .error-message:visible, [data-qa='error-message']:visible")
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "invalid" as const),
    ]).catch(() => "unknown" as const);
    await saveScreenshot(page, screenshotPath);

    if (result === "submitted") return { outcome: "submitted", log, screenshotPath };
    if (result === "captcha") return { outcome: "blocked", log, screenshotPath, error: "Lever showed an hCaptcha challenge: needs you." };
    if (result === "invalid") {
      const msg = await page.locator(".application-error:visible, .error-message:visible").first().textContent().catch(() => null);
      return { outcome: "failed", log, screenshotPath, error: `Lever rejected the form${msg ? `: ${msg.trim()}` : ""}. Check the screenshot.` };
    }
    return { outcome: "failed", log, screenshotPath, error: "No confirmation after submitting; check the screenshot." };
  } catch (err) {
    return { outcome: "failed", log, screenshotPath, error: err instanceof Error ? err.message.split("\n")[0] : String(err) };
  } finally {
    await browser.close();
  }
}

async function fillOne(page: Page, a: PlannedAnswer, log: string[]) {
  const els = page.locator(byName(a.fieldId));
  if (!(await els.count())) {
    log.push(`- ${a.label}: field not on page, skipped`);
    return;
  }
  const el = els.first();
  const tag = await el.evaluate((e) => e.tagName.toLowerCase());
  const type = ((await el.getAttribute("type")) ?? "").toLowerCase();

  if (a.kind === "file") {
    await el.setInputFiles(String(a.value));
    log.push(`✓ ${a.label}: attached ${path.basename(String(a.value))}`);
    return;
  }
  if (a.kind === "location") {
    await fillLocation(page, el, String(a.value), a.label, log);
    return;
  }
  if (tag === "select") {
    // (No named helpers inside browser callbacks: tsx adds __name() calls the page doesn't have.)
    const options = await el.evaluate((s) => [...(s as HTMLSelectElement).options].map((o) => ({ text: o.text, value: o.value })));
    const want = norm(String(Array.isArray(a.value) ? a.value[0] : a.value));
    const value = (options.find((o) => norm(o.text) === want) ?? options.find((o) => norm(o.value) === want))?.value;
    if (value === undefined) throw new Error(`option "${a.value}" not found`);
    await el.selectOption(value);
    log.push(`✓ ${a.label}: ${a.value}`);
    return;
  }
  if (type === "radio" || type === "checkbox") {
    const wanted = Array.isArray(a.value) ? a.value : [String(a.value)];
    const values = await els.evaluateAll((list) => list.map((e) => (e as HTMLInputElement).value));
    for (const w of wanted) {
      const i = values.findIndex((v) => norm(v) === norm(w));
      if (i < 0) throw new Error(`option "${w}" not found`);
      const box = els.nth(i);
      // Lever styles some choices with a custom box; clicking the label works when the input is hidden.
      await box.check({ timeout: 3_000 }).catch(() => box.locator("xpath=ancestor::label[1]").click());
    }
    log.push(`✓ ${a.label}: ${wanted.join(", ")}`);
    return;
  }
  // text / textarea
  await el.fill(String(a.value));
  log.push(`✓ ${a.label}`);
}

/** Lever's location field is an autocomplete; pick the first suggestion, else keep typed text. */
async function fillLocation(page: Page, el: Locator, value: string, label: string, log: string[]) {
  await el.click();
  await el.fill("");
  await el.pressSequentially(value, { delay: 40 });
  const first = page.locator(".dropdown-results > *:visible").first();
  try {
    await first.waitFor({ timeout: 8_000 });
    await first.click();
    log.push(`✓ ${label}: ${(await el.inputValue()) || value}`);
  } catch {
    await page.keyboard.press("Escape");
    log.push(`⚠ ${label}: no location suggestion for "${value}", left as typed`);
  }
}

/** Waits for Lever's resume upload/parse to finish (succeeds, fails, or is blocked in a dry run). */
async function waitForResumeParse(page: Page) {
  await page
    .waitForFunction(
      () => {
        const q = document.querySelector(".application-question.resume");
        return !q || !/\b(working|uploading)\b/.test(q.className);
      },
      undefined,
      { timeout: 20_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(500);
}

/** The CC-305 disability form asks for a signature (full name) and today's date. */
async function signDisabilityForm(page: Page, profile: Profile, log: string[]) {
  const sig = page.locator(byName("eeo[disabilitySignature]"));
  const date = page.locator(byName("eeo[disabilitySignatureDate]"));
  if (!(await sig.count()) || !(await sig.first().isVisible())) return;
  const name = [profile.firstName, profile.lastName].filter((s) => s.trim()).join(" ");
  if (!name) return;
  const d = new Date();
  const today = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  await sig.first().fill(name);
  if (await date.count()) await date.first().fill(today);
  log.push(`✓ Disability form signature: ${name}, ${today}`);
}

/** Labels of required fields that are still empty after filling. */
async function stillEmpty(page: Page) {
  const els = await page.$$eval("form#application-form [required]", (list) =>
    list.map((e) => {
      const input = e as HTMLInputElement;
      const q = e.closest(".application-question");
      return {
        name: input.name,
        type: input.type,
        skip: input.type === "hidden" || input.disabled,
        // The resume input is invisible (a styled button opens it), so files skip the visibility check.
        visible: input.type === "file" || Boolean(input.offsetParent),
        filled:
          input.type === "file"
            ? Boolean(input.files?.length)
            : input.type === "radio" || input.type === "checkbox"
              ? document.querySelectorAll(`[name="${CSS.escape(input.name)}"]:checked`).length > 0
              : Boolean(input.value),
        label: (q?.querySelector(".application-label .text, .application-label")?.textContent ?? input.name)
          .replace(/✱/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      };
    }),
  );
  return [...new Set(els.filter((e) => !e.skip && e.visible && !e.filled).map((e) => e.label))];
}
