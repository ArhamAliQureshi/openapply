import "server-only";
import { saveScreenshot } from "./screenshot";
import { trackedLog } from "@/lib/activity";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright";
import type { Profile } from "@/lib/profile-schema";
import type { FillResult } from "./greenhouse-fill";
import type { PlannedAnswer } from "./types";

// Fills a Recruitee application form ({company}.recruitee.com/o/{slug}/c/new, or the company's
// custom careers domain it redirects to) in a headless Chromium.
// Dry run: every non-GET request is blocked. The form is server-rendered, so it needs no
// exception: analytics, the hCaptcha check, file uploads and the submit POST are all blocked,
// and Submit is never clicked.
// Field ids: standard ones as in recruiteeFields (name/email/phone/resume/cover_letter/photo),
// questions and agreements by their DOM `name`.

export type { FillResult };

const SCREENSHOT_DIR = path.join(process.cwd(), ".data", "screenshots");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exact = (s: string) => new RegExp(`^\\s*${escapeRe(s.trim())}\\s*$`, "i");
const css = (s: string) => s.replace(/"/g, '\\"');
const errText = (err: unknown) => (err instanceof Error ? err.message.split("\n")[0] : String(err));

const DOM_NAME: Record<string, string> = {
  name: "candidate.name",
  email: "candidate.email",
  phone: "candidate.phone",
  resume: "candidate.cv",
  cover_letter: "candidate.coverLetter",
  photo: "candidate.photo",
};

export async function fillRecruitee(opts: {
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
    const form = page.locator("form#offer-application-form");
    await form.waitFor({ timeout: 20_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await declineCookies(page);
    await clearOverlays(page, form);

    const phoneCountry = opts.profile.phoneCountry || opts.profile.country;
    for (const a of opts.answers) {
      try {
        if (a.fieldId === "phone" && phoneCountry) {
          await choosePhoneCountry(page, form, phoneCountry, log).catch((err) => log.push(`⚠ Phone country: ${errText(err)}`));
        }
        await fillOne(form, a, log);
      } catch (err) {
        log.push(`✗ ${a.label.slice(0, 80)}: ${errText(err)}`);
      }
    }

    const emptyRequired = await stillEmpty(form);
    if (emptyRequired.length) log.push(`⚠ Still empty: ${emptyRequired.map((l) => l.slice(0, 80)).join(", ")}`);

    if (!opts.live) {
      log.push(`Dry run: Submit not clicked; blocked ${blocked} outgoing request(s) so nothing was sent.`);
      await saveScreenshot(page, screenshotPath);
      return { outcome: "dry_run_done", log, screenshotPath };
    }

    // Live submit. Recruitee runs an invisible hCaptcha on submit; if it shows a challenge we
    // stop and hand over to the user (never solved or bypassed).
    await form.locator('[data-testid="submit-application-form-button"], button[type="submit"]').first().click();
    const result = await Promise.race([
      page
        .getByText(/all done!|application has been (successfully )?submitted|thank(s| you) for (applying|your application)/i)
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "submitted" as const),
      page
        .locator('iframe[src*="hcaptcha"][src*="challenge"], iframe[title*="hCaptcha challenge" i], iframe[src*="recaptcha/api2/bframe"]')
        .first()
        .waitFor({ state: "visible", timeout: 45_000 })
        .then(() => "captcha" as const),
      page
        .locator('form#offer-application-form [aria-invalid="true"]')
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "invalid" as const),
      page
        .getByText(/already applied/i)
        .first()
        .waitFor({ timeout: 45_000 })
        .then(() => "duplicate" as const),
    ]).catch(() => "unknown" as const);
    await saveScreenshot(page, screenshotPath);

    if (result === "submitted") return { outcome: "submitted", log, screenshotPath };
    if (result === "captcha") return { outcome: "blocked", log, screenshotPath, error: "Recruitee showed an hCaptcha challenge: needs you." };
    if (result === "duplicate") return { outcome: "failed", log, screenshotPath, error: "Recruitee says you've already applied." };
    if (result === "invalid") {
      const msgs = await form.locator('[role="alert"]').allTextContents().catch(() => []);
      const detail = msgs.map((m) => m.trim()).filter(Boolean).slice(0, 3).join("; ");
      return { outcome: "failed", log, screenshotPath, error: `Recruitee rejected the form${detail ? `: ${detail}` : ""}. Check the screenshot.` };
    }
    return { outcome: "failed", log, screenshotPath, error: "No confirmation after submitting; check the screenshot." };
  } catch (err) {
    return { outcome: "failed", log, screenshotPath, error: errText(err) };
  } finally {
    await browser.close();
  }
}

async function fillOne(form: Locator, a: PlannedAnswer, log: string[]) {
  const name = DOM_NAME[a.fieldId] ?? a.fieldId;
  const value = a.value;

  if (a.kind === "file") {
    const file = form.locator(`input[type="file"][name="${css(name)}"], input[type="file"][name="${css(name)}.file"]`).first();
    if (!(await file.count())) return void log.push(`- ${a.label}: field not on page, skipped`);
    await file.setInputFiles(String(value));
    log.push(`✓ ${a.label}: attached ${path.basename(String(value))}`);
    return;
  }

  // Cover letter: the form shows a file upload until "Write it here instead" is clicked.
  if (a.fieldId === "cover_letter" && !(await form.locator(`textarea[name="${css(name)}"]`).count())) {
    await form.locator('[data-cy="cover-letter-switch-button"]').click();
  }

  // Agreements: one consent checkbox.
  if (/^candidate\.agreements\.\d+\.consent$/.test(name)) {
    const box = form.locator(`input[type="checkbox"][name="${css(name)}"]`);
    if (!(await box.count())) return void log.push(`- ${a.label.slice(0, 60)}: field not on page, skipped`);
    if (!(await box.isChecked())) await pick(form, box);
    log.push(`✓ ${a.label.slice(0, 60)}…: checked`);
    return;
  }

  // Open questions answer at `.content` (text, choices) or `.flag` (yes/no).
  const isQuestion = name.startsWith("candidate.openQuestionAnswers.");
  const flag = form.locator(`input[type="radio"][name="${css(name)}.flag"]`);
  if (isQuestion && (await flag.count())) {
    const want = String(Array.isArray(value) ? value[0] : value);
    const v = /^yes\b/i.test(want) ? "true" : /^no\b/i.test(want) ? "false" : null;
    if (!v) throw new Error(`option "${want}" not found`);
    await pick(form, form.locator(`input[type="radio"][name="${css(name)}.flag"][value="${v}"]`));
    log.push(`✓ ${a.label.slice(0, 80)}: ${want}`);
    return;
  }
  const target = isQuestion ? `${name}.content` : name;
  const choices = form.locator(`input[type="radio"][name="${css(target)}"], input[type="checkbox"][name^="${css(target)}"]`);
  if (await choices.count()) {
    const wanted = Array.isArray(value) ? value : [String(value)];
    const values = await choices.evaluateAll((list) =>
      list.map((e) => ({ value: (e as HTMLInputElement).value, label: e.id ? (document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent ?? "") : "" })),
    );
    for (const w of wanted) {
      const i = values.findIndex((o) => exact(w).test(o.value) || exact(w).test(o.label));
      if (i < 0) throw new Error(`option "${w}" not found`);
      await pick(form, choices.nth(i));
    }
    log.push(`✓ ${a.label.slice(0, 80)}: ${wanted.join(", ")}`);
    return;
  }
  const select = form.locator(`select[name="${css(target)}"]`);
  if (await select.count()) {
    await select.selectOption({ label: String(Array.isArray(value) ? value[0] : value).trim() });
    log.push(`✓ ${a.label.slice(0, 80)}: ${value}`);
    return;
  }

  const input = form.locator(`input[name="${css(target)}"]:not([type="hidden"]), textarea[name="${css(target)}"]`).first();
  if (!(await input.count())) return void log.push(`- ${a.label.slice(0, 80)}: field not on page, skipped`);
  await input.scrollIntoViewIfNeeded();
  if ((await input.getAttribute("type")) === "number") {
    // Salary / number questions take digits only ("€90,000" → "90000").
    const digits = String(value).replace(/[^\d.]/g, "");
    if (!digits) throw new Error(`"${value}" is not a number`);
    await input.fill(digits);
  } else if (a.fieldId === "phone") {
    // The phone input keeps the country calling code ("+971 ") that choosePhoneCountry set.
    const phone = String(value).trim();
    const prefix = (await input.inputValue()).match(/^\+\d+/)?.[0] ?? "";
    await input.fill(phone.startsWith("+") || !prefix ? phone : `${prefix} ${phone}`);
  } else {
    await input.fill(String(value));
  }
  log.push(`✓ ${a.label.slice(0, 80)}`);
}

/**
 * Declines optional cookies in whichever consent banner the careers site uses (Recruitee's own,
 * or a company's Cookiebot / OneTrust), since an open banner covers the form and blocks clicks.
 */
async function declineCookies(page: Page) {
  const buttons = page.locator(
    [
      "#CybotCookiebotDialogBodyButtonDecline",
      "#onetrust-reject-all-handler",
      'button:has-text("Agree to necessary")',
      'button:has-text("Decline all")',
      'button:has-text("Reject all")',
    ].join(", "),
  );
  for (let i = 0; i < 2; i++) {
    const visible = buttons.locator("visible=true").first();
    if (!(await visible.isVisible({ timeout: 2_000 }).catch(() => false))) break;
    await visible.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
  // Banners without a decline button are hidden instead (nothing is accepted).
  await page
    .addStyleTag({ content: "#CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, #onetrust-banner-sdk, .onetrust-pc-dark-filter { display: none !important; }" })
    .catch(() => {});
}

/**
 * Companies can add their own pop-ups to Recruitee pages (e.g. a "beware of recruitment scams"
 * notice) and cookie dialogs without a decline button, which sit on top of the form. Closes
 * each overlay with its own close button if it has one, otherwise hides it (no consent given).
 */
async function clearOverlays(page: Page, form: Locator) {
  for (let i = 0; i < 4; i++) {
    const found = await form.evaluate((el) => {
      document.querySelectorAll("[data-applykit-close]").forEach((b) => b.removeAttribute("data-applykit-close"));
      const probe = el.querySelector<HTMLElement>("input:not([type=hidden]), button") ?? el;
      probe.scrollIntoView({ block: "center" });
      const r = probe.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + Math.min(r.width, 20) / 2 + 1, r.top + r.height / 2);
      if (!hit || el.contains(hit) || hit.contains(el)) return "clear";
      // The overlay: the outermost fixed/absolute ancestor of whatever covers the form.
      let overlay: HTMLElement | null = null;
      for (let n: HTMLElement | null = hit as HTMLElement; n && n !== document.body; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === "fixed" || pos === "absolute") overlay = n;
      }
      overlay = overlay ?? (hit as HTMLElement);
      const close = [...overlay.querySelectorAll<HTMLElement>("button, [role=button], a")].find((b) =>
        /^(×|✕|x|close|ok|got it|decline( all)?|reject( all)?|agree to necessary|use necessary cookies only)$/i.test(
          (b.getAttribute("aria-label") ?? b.textContent ?? "").trim(),
        ),
      );
      if (close && overlay.getAttribute("data-applykit-tried") !== "1") {
        overlay.setAttribute("data-applykit-tried", "1");
        close.setAttribute("data-applykit-close", "1");
        return "close";
      }
      overlay.style.setProperty("display", "none", "important");
      return "hidden";
    });
    if (found === "clear") return;
    if (found === "close") {
      await page.locator("[data-applykit-close]").first().click({ timeout: 3_000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
  }
}

/** Ticks a (visually hidden) radio/checkbox by clicking its label, as a user would. */
async function pick(form: Locator, input: Locator) {
  const id = await input.getAttribute("id");
  const label = id ? form.locator(`label[for="${css(id)}"]`) : input.locator("xpath=ancestor::label[1]");
  if (await label.count()) await label.first().click();
  else await input.check({ force: true });
  if (!(await input.isChecked())) await input.check({ force: true });
  if (!(await input.isChecked())) throw new Error("the choice did not stay selected");
}

/** Picks the phone country in Recruitee's calling-code dropdown. */
async function choosePhoneCountry(page: Page, form: Locator, country: string, log: string[]) {
  const button = form.locator('button[id^="country-select-input-candidate.phone"]').first();
  if (!(await button.count())) return;
  if (new RegExp(`:\\s*${escapeRe(country)}$`, "i").test((await button.getAttribute("aria-label")) ?? "")) return;
  await button.click();
  const listbox = page.locator(`[role="listbox"][aria-labelledby="${css((await button.getAttribute("id")) ?? "")}"]`);
  await listbox.locator('[role="option"]').first().waitFor({ timeout: 5_000 });
  // The list is virtualized (only ~10 countries exist in the DOM at a time): scroll until it renders.
  const option = listbox.locator(`[role="option"][aria-label="${css(country)}" i]`).first();
  for (let i = 0; i < 40 && !(await option.count()); i++) {
    await listbox.evaluate((l) => {
      const scroller = [l, ...l.querySelectorAll<HTMLElement>("*")].find((e) => e.scrollHeight > e.clientHeight + 10);
      if (scroller) scroller.scrollTop += 400;
    });
    await page.waitForTimeout(60);
  }
  if (!(await option.count())) {
    await page.keyboard.press("Escape");
    throw new Error(`"${country}" not in the country list`);
  }
  await option.click();
  log.push(`✓ Phone country: ${country}`);
}

/** Labels of required questions that are still empty after filling. */
async function stillEmpty(form: Locator) {
  return form.evaluate((el) => {
    const out: string[] = [];
    const seen = new Set<string>();
    el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[required]").forEach((input) => {
      const name = input.getAttribute("name") ?? input.id;
      if (!name || seen.has(name) || input.disabled || input.type === "hidden") return;
      seen.add(name);
      let filled: boolean;
      if (input.type === "file") filled = Boolean((input as HTMLInputElement).files?.length);
      else if (input.type === "radio" || input.type === "checkbox") filled = el.querySelectorAll(`[name="${CSS.escape(name)}"]:checked`).length > 0;
      else filled = Boolean(input.value.trim()) && !/^\+\d{1,4}$/.test(input.value.trim()); // phone "+31" alone is empty
      if (filled) return;
      const fieldset = input.closest("fieldset");
      const label =
        (input.type === "radio" ? fieldset?.querySelector("legend")?.textContent : null) ??
        (input.id ? el.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : null) ??
        name;
      out.push(label.replace(/\s+/g, " ").replace(/\*\s*$/, "").trim());
    });
    return out;
  });
}
