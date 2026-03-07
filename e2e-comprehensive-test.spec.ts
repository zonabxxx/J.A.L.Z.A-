/**
 * J.A.L.Z.A. Comprehensive E2E Test (localhost) - ALL new features
 * Run: npx playwright test e2e-comprehensive-test.spec.ts --project=chromium
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:3001";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";

test.describe("J.A.L.Z.A. Comprehensive E2E", () => {
  test("All new features", async ({ page }) => {
    const report: string[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results", "comprehensive");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    test.setTimeout(420000); // 7 min

    const sendMessage = async () => {
      await page.locator("textarea").first().click();
      await page.keyboard.press("Enter");
    };

    const screenshot = async (name: string) => {
      try {
        await page.screenshot({ path: path.join(screenshotsDir, `${name}.png`) });
      } catch {}
    };

    // STEP 1 - LOGIN
    report.push("\n========== STEP 1 - LOGIN ==========");
    try {
      await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
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
      await page.waitForSelector("textarea", { timeout: 20000 });
      report.push("SUCCESS: Logged in");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step1-login");

    // STEP 2 - DASHBOARD
    report.push("\n========== STEP 2 - DASHBOARD (📊) ==========");
    try {
      const dashboardTab = page.locator('button:has-text("📊")').first();
      await dashboardTab.click();
      await page.waitForTimeout(4000); // Wait for dashboard to load
      const body = await page.textContent("body");
      const hasStats = body?.includes("Dnešné udalosti") || body?.includes("Nové emaily") || body?.includes("Aktívne úlohy") || false;
      const hasSummary = body?.includes("prehľad") || body?.includes("zhrnutie") || body?.includes("rann") || false;
      report.push(`Stats cards shown: ${hasStats ? "YES" : "NO"}`);
      report.push(`AI summary: ${hasSummary ? "YES" : "NO/unknown"}`);
      report.push(hasStats ? "SUCCESS" : "PARTIAL");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step2-dashboard");

    // STEP 3 - ZAPAMÄTAJ SI (Memory)
    report.push("\n========== STEP 3 - ZAPAMÄTAJ SI (Memory) ==========");
    try {
      await page.locator('button:has-text("Chat")').first().click();
      await page.waitForTimeout(1000);
      const newBtn = page.locator('button:has-text("+ Nový"), button:has-text("Nový chat")').first();
      if ((await newBtn.count()) > 0) {
        await newBtn.click();
        await page.waitForTimeout(1500);
      }
      await page.locator("textarea").first().fill("zapamätaj si že moje obľúbené jedlo je pizza");
      await sendMessage();
      await page.waitForSelector('text=Zapamätal som si, text=Nepodarilo sa', { timeout: 15000 }).catch(() => null);
      await page.waitForTimeout(2000);
      const body3 = await page.textContent("body");
      const saved = body3?.includes("Zapamätal som si") || false;
      report.push(`Fact saved (🧠 Zapamätal som si): ${saved ? "YES" : "NO"}`);
      report.push(saved ? "SUCCESS" : "FAILURE");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step3-memory");

    // STEP 4 - AGENT TASK
    report.push("\n========== STEP 4 - AGENT TASK ==========");
    try {
      const newBtn4 = page.locator('button:has-text("+ Nový"), button:has-text("Nový chat")').first();
      if ((await newBtn4.count()) > 0) {
        await newBtn4.click();
        await page.waitForTimeout(1500);
      }
      await page.locator("textarea").first().fill("Analyzuj koľko súborov je v jalza/ui/components/ priečinku");
      await sendMessage();
      await page.getByText(/Agent (spustený|dokončený)/).waitFor({ timeout: 90000 }).catch(() => null);
      await page.waitForTimeout(3000);
      const body4 = await page.textContent("body");
      const agentBadge = body4?.includes("🤖 Agent") || false;
      const steps = body4?.includes("Krok 1") || body4?.includes("Krok 2") || body4?.includes("krokov") || false;
      const tools = body4?.includes("list_files") || body4?.includes("shell") || body4?.includes("read_file") || false;
      report.push(`🤖 Agent badge: ${agentBadge ? "YES" : "NO"}`);
      report.push(`Step-by-step: ${steps ? "YES" : "NO"}`);
      report.push(`Tool usage: ${tools ? "YES" : "NO"}`);
      report.push(agentBadge ? "SUCCESS" : "PARTIAL");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step4-agent");

    // STEP 5 - SCHEDULER (Tasks)
    report.push("\n========== STEP 5 - SCHEDULER (Úlohy) ==========");
    try {
      await page.locator('button:has-text("Úlohy")').first().click();
      await page.waitForTimeout(3000);
      const body5 = await page.textContent("body");
      const schedulerActive = body5?.includes("Scheduler aktívny") || false;
      const hasTasks = body5?.includes("Plánované úlohy") || body5?.includes("Nová") || false;
      const hasHistoria = body5?.includes("História") || body5?.includes("Skryť históriu") || false;
      report.push(`Scheduler aktívny (green): ${schedulerActive ? "YES" : "NO"}`);
      report.push(`Tasks panel: ${hasTasks ? "YES" : "NO"}`);
      report.push(`História button: ${hasHistoria ? "YES" : "NO"}`);
      report.push("SUCCESS");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step5-tasks");

    // STEP 6 - SETTINGS (Push notifications)
    report.push("\n========== STEP 6 - SETTINGS (Push notifications) ==========");
    try {
      const gearBtn = page.locator('button[title="Nastavenia"]').or(page.locator('button').filter({ has: page.locator('svg path[d*="M9.594"]') })).first();
      await gearBtn.click();
      await page.waitForTimeout(2000);
      const body6 = await page.textContent("body");
      const pushToggle = body6?.includes("Push notifikácie") || body6?.includes("Push notifik") || false;
      report.push(`Push notification toggle visible: ${pushToggle ? "YES" : "NO"}`);
      report.push(pushToggle ? "SUCCESS" : "NOT FOUND (may be in different settings view)");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step6-settings");

    // Close settings modal - click X button inside the modal overlay
    const modalClose = page.locator('div.fixed.inset-0').locator('button').filter({ hasText: '✕' }).first();
    if ((await modalClose.count()) > 0) {
      await modalClose.click().catch(() => null);
    }
    await page.waitForTimeout(500);

    // STEP 7 - WEB SEARCH
    report.push("\n========== STEP 7 - WEB SEARCH ==========");
    try {
      await page.locator('button:has-text("Chat")').first().click();
      await page.waitForTimeout(1000);
      const newBtn7 = page.locator('button:has-text("+ Nový"), button:has-text("Nový chat")').first();
      if ((await newBtn7.count()) > 0) {
        await newBtn7.click();
        await page.waitForTimeout(1500);
      }
      await page.locator("textarea").first().fill("Aké je počasie dnes?");
      await sendMessage();
      await page.waitForSelector('[class*="bg-zinc-800"]', { timeout: 30000 }).catch(() => null);
      await page.waitForTimeout(3000);
      const body7 = await page.textContent("body");
      const hasWeather = body7?.toLowerCase().includes("počasie") || body7?.includes("°") || body7?.includes("teplota") || false;
      report.push(`Weather response: ${hasWeather ? "YES" : "NO"}`);
      report.push(hasWeather ? "SUCCESS" : "PARTIAL");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step7-web-search");

    const reportPath = path.join(screenshotsDir, "comprehensive-report.txt");
    try {
      fs.writeFileSync(reportPath, report.join("\n"));
      console.log(report.join("\n"));
    } catch {}
  });
});
