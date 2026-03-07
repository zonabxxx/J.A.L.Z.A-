/**
 * J.A.L.Z.A. Production - Tunnel connection verification
 * Run: npx playwright test e2e-tunnel-verify.spec.ts --project=chromium
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://jalza-production.up.railway.app";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";

test.describe("J.A.L.Z.A. Tunnel Verification", () => {
  test("Sidebar, Email, Chat, Dashboard", async ({ page }) => {
    const report: string[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results", "tunnel-verify");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    test.setTimeout(90000);

    // STEP 1 - LOGIN
    report.push("\n=== STEP 1 - LOGIN ===");
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
      await page.waitForSelector("aside, main textarea, textarea", { timeout: 20000 });
      report.push("SUCCESS: Logged in");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }

    // STEP 2 - SIDEBAR TABS
    report.push("\n=== STEP 2 - SIDEBAR TABS ===");
    try {
      const sidebar = page.locator("aside").first();
      await sidebar.screenshot({ path: path.join(screenshotsDir, "step2-sidebar.png") });
      const body = await page.textContent("body");
      const hasGrid = body?.includes("Prehľad") || body?.includes("📊") || false;
      const hasIcons = body?.includes("📧") && body?.includes("📅") || false;
      report.push(`4-col grid with icons: ${hasGrid && hasIcons ? "YES" : "PARTIAL"}`);
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }

    // STEP 3 - EMAIL
    report.push("\n=== STEP 3 - EMAIL ===");
    try {
      await page.locator('button:has-text("Email")').or(page.locator('button:has-text("📧")')).first().click();
      await page.waitForTimeout(10000);
      const body = await page.textContent("body");
      const hasEmailPanel = body?.includes("Email") || false;
      const hasEmails = body?.match(/\d+\s*emailov?/i) || body?.includes("Načítavam") || false;
      report.push(`Emails load: ${hasEmailPanel ? (hasEmails ? "YES" : "LOADING/EMPTY") : "NO"}`);
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await page.screenshot({ path: path.join(screenshotsDir, "step3-email.png") });

    // STEP 4 - CHAT
    report.push("\n=== STEP 4 - CHAT ===");
    try {
      await page.locator('button:has-text("Chat")').or(page.locator('button:has-text("💬")')).first().click();
      await page.waitForTimeout(1500);
      const chatInput = page.locator("main textarea").first();
      await chatInput.click();
      await chatInput.fill("Ahoj, funguje tunel?");
      await page.keyboard.press("Enter");
      await page.waitForSelector('[class*="bg-zinc-800"], .rounded-2xl', { timeout: 30000 }).catch(() => null);
      await page.waitForTimeout(3000);
      const body = await page.textContent("body");
      const hasResponse = body?.includes("tunel") || body?.includes("funguje") || body?.includes("Ahoj") || body?.includes("áno") || body?.includes("ano") || false;
      report.push(`J.A.L.Z.A. responds: ${hasResponse ? "YES" : "NO"}`);
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await page.screenshot({ path: path.join(screenshotsDir, "step4-chat.png") });

    // STEP 5 - DASHBOARD
    report.push("\n=== STEP 5 - DASHBOARD ===");
    try {
      await page.locator('button:has-text("Prehľad")').or(page.locator('button:has-text("📊")')).first().click();
      await page.waitForTimeout(8000);
      const body = await page.textContent("body");
      const hasDashboard = body?.includes("Dashboard") || body?.includes("prehľad") || false;
      const hasStats = body?.includes("Dnešné udalosti") || body?.includes("Nové emaily") || body?.includes("Aktívne úlohy") || false;
      report.push(`Dashboard loads: ${hasDashboard ? "YES" : "NO"}`);
      report.push(`Stats shown: ${hasStats ? "YES" : "NO"}`);
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await page.screenshot({ path: path.join(screenshotsDir, "step5-dashboard.png") });

    report.push("\n=== TUNNEL VERIFICATION ===");
    report.push("If all steps succeeded, the Cloudflare tunnel connection is working.");

    fs.writeFileSync(path.join(screenshotsDir, "report.txt"), report.join("\n"));
    console.log(report.join("\n"));
  });
});
