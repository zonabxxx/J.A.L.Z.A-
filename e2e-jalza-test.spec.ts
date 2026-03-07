/**
 * J.A.L.Z.A. Production E2E Test
 * Run: npx playwright test e2e-jalza-test.spec.ts --project=chromium
 * Or: npx playwright test e2e-jalza-test.spec.ts --headed
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://jalza-production.up.railway.app";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";

function durationLabel(ms: number): string {
  if (ms < 5000) return "fast (<5s)";
  if (ms < 15000) return "medium (5-15s)";
  if (ms < 60000) return "slow (15-60s)";
  return "timeout (>60s)";
}

test.describe("J.A.L.Z.A. Production E2E", () => {
  test("Full E2E test suite", async ({ page }) => {
    const report: { step: string; status: string; details: string; duration?: number; durationLabel?: string }[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    const sendMessage = async () => {
      await page.locator("textarea").first().click();
      await page.keyboard.press("Enter");
    };

    // STEP 1 - LOGIN
    let stepStart = Date.now();
    test.setTimeout(300000); // 5 min for full test
    try {
      await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForLoadState("domcontentloaded");

      const loginInput = page.locator('input[name="username"], input[placeholder="Meno"]');
      await loginInput.first().waitFor({ state: "visible", timeout: 15000 });
      await loginInput.first().fill(TEST_NAME);
      await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);

      // If registration mode: fill setup key. If login mode: we're done.
      const setupKeyInput = page.locator('input[placeholder="Registračný kľúč"]');
      if ((await setupKeyInput.count()) > 0) {
        await setupKeyInput.fill(SETUP_KEY);
      }

      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(2000);

      // If "user already exists", switch to login and retry
      const userExists = await page.locator('text=Používateľ s týmto menom už existuje').count() > 0;
      if (userExists) {
        await page.locator('button:has-text("Už mám účet? Prihlásiť sa")').click();
        await page.waitForTimeout(500);
        await loginInput.first().fill(TEST_NAME);
        await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
        await page.locator('button[type="submit"]').click();
      }

      await page.waitForSelector('textarea', { timeout: 25000 });
      const d1 = Date.now() - stepStart;
      report.push({
        step: "STEP 1 - LOGIN",
        status: "SUCCESS",
        details: "Logged in successfully",
        duration: d1,
        durationLabel: durationLabel(d1),
      });
    } catch (e) {
      report.push({
        step: "STEP 1 - LOGIN",
        status: "FAILURE",
        details: String(e),
        duration: Date.now() - stepStart,
        durationLabel: "error",
      });
    }
    try {
      await page.screenshot({ path: path.join(screenshotsDir, "step1-login.png") });
    } catch {}

    // STEP 2 - CHAT (personal)
    stepStart = Date.now();
    try {
      const textarea = page.locator('textarea').first();
      await textarea.fill("Kto som? Povedz mi moje meno a info o rodine.");
      await sendMessage();
      await page.waitForSelector('[class*="bg-zinc-800"]', { timeout: 70000 });
      const body2 = await page.textContent("body");
      const hasPersonal = body2?.includes("Tester") || body2?.includes("meno") || body2?.includes("rodin") || false;
      const hasFallback = body2?.includes("Lokálny model nedostupný") || body2?.includes("nedostupný") || false;
      const d2 = Date.now() - stepStart;
      report.push({
        step: "STEP 2 - PERSONAL CHAT",
        status: "SUCCESS",
        details: `Personal info: ${hasPersonal}. Gemini fallback: ${hasFallback ? "yes" : "no"}`,
        duration: d2,
        durationLabel: durationLabel(d2),
      });
    } catch (e) {
      report.push({
        step: "STEP 2 - PERSONAL CHAT",
        status: "FAILURE",
        details: String(e),
        duration: Date.now() - stepStart,
        durationLabel: "error",
      });
    }
    try {
      await page.screenshot({ path: path.join(screenshotsDir, "step2-chat-personal.png") });
    } catch {}

    // STEP 3 - WEB SEARCH (new chat)
    stepStart = Date.now();
    try {
      const newChatBtn = page.locator('button:has-text("+ Nový"), button:has-text("Nový chat")').first();
      if (await newChatBtn.count() > 0) {
        await newChatBtn.click();
        await page.waitForTimeout(2000);
      }
      await page.locator('textarea').first().fill("Aké je dnes počasie v Bratislave?");
      await sendMessage();
      await page.waitForSelector('.text-zinc-200, [class*="bg-zinc-800"]', { timeout: 30000 });
      const body3 = await page.textContent("body");
      const hasWeather =
        body3?.toLowerCase().includes("počasie") ||
        body3?.toLowerCase().includes("bratislava") ||
        body3?.includes("°") ||
        false;
      const d3 = Date.now() - stepStart;
      report.push({
        step: "STEP 3 - WEB SEARCH",
        status: "SUCCESS",
        details: `Weather response: ${hasWeather ? "yes" : "no"}`,
        duration: d3,
        durationLabel: durationLabel(d3),
      });
    } catch (e) {
      report.push({
        step: "STEP 3 - WEB SEARCH",
        status: "FAILURE",
        details: String(e),
        duration: Date.now() - stepStart,
        durationLabel: "error",
      });
    }
    try {
      await page.screenshot({ path: path.join(screenshotsDir, "step3-web-search.png") });
    } catch {}

    // STEP 4 - KNOWLEDGE AGENT (ADsun)
    stepStart = Date.now();
    try {
      const adsunBtn = page.locator('button:has-text("ADsun"), [role="button"]:has-text("ADsun")').first();
      if (await adsunBtn.count() > 0) {
        await adsunBtn.click();
        await page.waitForTimeout(1500);
      }
      await page.locator('textarea').first().fill("Čo je ADSUN? Aké služby ponúka?");
      await sendMessage();
      await page.waitForSelector('.text-zinc-200, [class*="bg-zinc-800"]', { timeout: 60000 });
      const body4 = await page.textContent("body");
      const hasAdsun = body4?.toLowerCase().includes("adsun") || false;
      const d4 = Date.now() - stepStart;
      report.push({
        step: "STEP 4 - KNOWLEDGE AGENT",
        status: hasAdsun ? "SUCCESS" : "PARTIAL",
        details: `ADsun info: ${hasAdsun ? "yes" : "no"}`,
        duration: d4,
        durationLabel: durationLabel(d4),
      });
    } catch (e) {
      report.push({
        step: "STEP 4 - KNOWLEDGE AGENT",
        status: "FAILURE",
        details: String(e),
        duration: Date.now() - stepStart,
        durationLabel: "error",
      });
    }
    try {
      await page.screenshot({ path: path.join(screenshotsDir, "step4-knowledge-agent.png") });
    } catch {}

    // STEP 5 - CALENDAR
    stepStart = Date.now();
    try {
      const calBtn = page.locator('button:has-text("Kalendár")').first();
      await calBtn.click();
      await page.waitForTimeout(2000);
      const hasCal = (await page.locator('text=Kalendár').count()) > 0;
      const d5 = Date.now() - stepStart;
      report.push({
        step: "STEP 5 - CALENDAR",
        status: hasCal ? "SUCCESS" : "PARTIAL",
        details: `Calendar view: ${hasCal ? "yes" : "no"}`,
        duration: d5,
        durationLabel: durationLabel(d5),
      });
    } catch (e) {
      report.push({
        step: "STEP 5 - CALENDAR",
        status: "FAILURE",
        details: String(e),
        duration: Date.now() - stepStart,
        durationLabel: "error",
      });
    }
    try {
      await page.screenshot({ path: path.join(screenshotsDir, "step5-calendar.png") });
    } catch {}

    // STEP 6 - EMAIL
    stepStart = Date.now();
    try {
      const emailBtn = page.locator('button:has-text("Email")').first();
      await emailBtn.click();
      await page.waitForTimeout(2000);
      const hasEmail = (await page.locator('text=Email').count()) > 0;
      const d6 = Date.now() - stepStart;
      report.push({
        step: "STEP 6 - EMAIL",
        status: hasEmail ? "SUCCESS" : "PARTIAL",
        details: `Email view: ${hasEmail ? "yes" : "no"}`,
        duration: d6,
        durationLabel: durationLabel(d6),
      });
    } catch (e) {
      report.push({
        step: "STEP 6 - EMAIL",
        status: "FAILURE",
        details: String(e),
        duration: Date.now() - stepStart,
        durationLabel: "error",
      });
    }
    try {
      await page.screenshot({ path: path.join(screenshotsDir, "step6-email.png") });
    } catch {}

    // Write report
    const reportPath = path.join(screenshotsDir, "test-report.txt");
    const lines = [
      "========== J.A.L.Z.A. E2E TEST REPORT ==========",
      ...report.map((r) => `[${r.status}] ${r.step}: ${r.details} (${r.duration}ms, ${r.durationLabel})`),
      "================================================\n",
    ];
    fs.writeFileSync(reportPath, lines.join("\n"));
    console.log("\n" + lines.join("\n"));
  });
});
