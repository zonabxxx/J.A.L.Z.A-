/**
 * J.A.L.Z.A. Production - Quick panels test (Email, Calendar, MCP, Usage, Dashboard)
 * Run: npx playwright test e2e-panels-production.spec.ts --project=chromium
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://jalza-production.up.railway.app";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";

test.describe("J.A.L.Z.A. Production Panels", () => {
  test("Email, Calendar, MCP, Usage, Dashboard", async ({ page }) => {
    const report: string[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results", "panels-production");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    test.setTimeout(120000); // 2 min

    const screenshot = async (name: string) => {
      try {
        await page.screenshot({ path: path.join(screenshotsDir, `${name}.png`) });
      } catch {}
    };

    // STEP 1 - LOGIN
    report.push("\n========== STEP 1 - LOGIN ==========");
    try {
      await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(3000);

      const loginInput = page.locator('input[name="username"], input[placeholder="Meno"]');
      if ((await loginInput.count()) > 0) {
        await loginInput.first().fill(TEST_NAME);
        const setupKeyInput = page.locator('input[placeholder="Registračný kľúč"]');
        if ((await setupKeyInput.count()) > 0) {
          await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
          await setupKeyInput.fill(SETUP_KEY);
        } else {
          await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
        }
        await page.locator('button[type="submit"]').click();
        await page.waitForTimeout(2000);
        if ((await page.locator('text=Používateľ s týmto menom už existuje').count()) > 0) {
          await page.locator('button:has-text("Už mám účet? Prihlásiť sa")').click();
          await page.waitForTimeout(500);
          await loginInput.first().fill(TEST_NAME);
          await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
          await page.locator('button[type="submit"]').click();
        }
      }
      await page.waitForSelector("main textarea, textarea", { timeout: 20000 });
      report.push("SUCCESS: Logged in");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step1-login");

    // STEP 2 - EMAIL
    report.push("\n========== STEP 2 - EMAIL ==========");
    try {
      await page.locator('button:has-text("Email")').first().click();
      await page.waitForTimeout(10000);
      const body = await page.textContent("body");
      const hasEmail = body?.includes("Email") || false;
      const emailCount = body?.match(/(\d+)\s*emailov?/i)?.[1] || "?";
      const hasError = body?.toLowerCase().includes("chyba") || body?.toLowerCase().includes("error") || false;
      report.push(`Emails load: ${hasEmail ? "YES" : "NO"}`);
      report.push(`Count shown: ${emailCount}`);
      report.push(`Errors: ${hasError ? "YES" : "NO"}`);
      report.push(hasEmail && !hasError ? "SUCCESS" : hasError ? "FAILURE" : "PARTIAL");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step2-email");

    // STEP 3 - CALENDAR
    report.push("\n========== STEP 3 - CALENDAR ==========");
    try {
      await page.locator('button:has-text("Kalendár")').first().click();
      await page.waitForTimeout(10000);
      const body = await page.textContent("body");
      const hasCal = body?.includes("Kalendár") || false;
      const hasEvents = body?.includes("udalost") || body?.includes("event") || body?.includes("Dnes") || body?.includes("Týždeň") || false;
      const hasError = body?.toLowerCase().includes("chyba") || body?.toLowerCase().includes("error") || false;
      report.push(`Calendar loads: ${hasCal ? "YES" : "NO"}`);
      report.push(`Events/view: ${hasEvents ? "YES" : "NO"}`);
      report.push(`Errors: ${hasError ? "YES" : "NO"}`);
      report.push(hasCal && !hasError ? "SUCCESS" : hasError ? "FAILURE" : "PARTIAL");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step3-calendar");

    // STEP 4 - MCP (Integrations)
    report.push("\n========== STEP 4 - MCP ==========");
    try {
      await page.locator('button:has-text("MCP")').first().click();
      await page.waitForTimeout(10000);
      const body = await page.textContent("body");
      const hasMcp = body?.includes("MCP") || body?.includes("Integrácie") || body?.includes("Pripojenia") || false;
      const hasIntegrations = body?.includes("email") || body?.includes("calendar") || body?.includes("telegram") || false;
      report.push(`MCP loads: ${hasMcp ? "YES" : "NO"}`);
      report.push(`Integrations shown: ${hasIntegrations ? "YES" : "NO"}`);
      report.push(hasMcp ? "SUCCESS" : "PARTIAL");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step4-mcp");

    // STEP 5 - USAGE (Spotreba)
    report.push("\n========== STEP 5 - USAGE (Spotreba) ==========");
    try {
      await page.locator('button:has-text("Spotreba")').first().click();
      await page.waitForTimeout(10000);
      const body = await page.textContent("body");
      const hasUsage = body?.includes("Spotreba") || body?.includes("Spotreba") || false;
      const hasStats = body?.includes("token") || body?.includes("dnes") || body?.includes("mesiac") || body?.includes("usage") || false;
      report.push(`Usage loads: ${hasUsage ? "YES" : "NO"}`);
      report.push(`Stats shown: ${hasStats ? "YES" : "NO"}`);
      report.push(hasUsage ? "SUCCESS" : "PARTIAL");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step5-usage");

    // STEP 6 - DASHBOARD
    report.push("\n========== STEP 6 - DASHBOARD ==========");
    try {
      await page.locator('button:has-text("📊")').first().click();
      await page.waitForTimeout(15000);
      const body = await page.textContent("body");
      const hasDashboard = body?.includes("Dashboard") || body?.includes("prehľad") || false;
      const hasStats = body?.includes("Dnešné udalosti") || body?.includes("Nové emaily") || body?.includes("Aktívne úlohy") || false;
      const hasSummary = body?.includes("prehľad") || body?.includes("zhrnutie") || body?.includes("rann") || false;
      report.push(`Dashboard loads: ${hasDashboard ? "YES" : "NO"}`);
      report.push(`Stats cards: ${hasStats ? "YES" : "NO"}`);
      report.push(`AI summary: ${hasSummary ? "YES" : "NO"}`);
      report.push(hasDashboard ? "SUCCESS" : "PARTIAL");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step6-dashboard");

    const reportPath = path.join(screenshotsDir, "report.txt");
    fs.writeFileSync(reportPath, report.join("\n"));
    console.log(report.join("\n"));
  });
});
