/**
 * J.A.L.Z.A. Chat Input Focused Test - targets MAIN content area textarea
 * Run: npx playwright test e2e-chat-input-test.spec.ts --project=chromium
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:3001";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";

// Chat input is in MAIN content area (right), NOT sidebar (left)
// Use: page.locator("main textarea").first()

test.describe("J.A.L.Z.A. Chat Input (main area)", () => {
  test("Memory, Agent, Settings", async ({ page }) => {
    const report: string[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results", "chat-input-test");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    test.setTimeout(200000); // ~3.3 min

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
      await page.waitForSelector("main textarea", { timeout: 20000 });
      report.push("SUCCESS: Logged in");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step1-login");

    // Ensure Chat tab
    await page.locator('button:has-text("Chat")').first().click();
    await page.waitForTimeout(1000);

    // STEP 2 - MEMORY (use main textarea)
    report.push("\n========== STEP 2 - MEMORY ==========");
    try {
      const chatInput = page.locator("main textarea").first();
      await chatInput.click();
      await chatInput.fill("zapamätaj si že moje obľúbené jedlo je pizza");
      await page.keyboard.press("Enter");
      await page.waitForSelector('text=Zapamätal som si, text=Nepodarilo sa', { timeout: 10000 }).catch(() => null);
      await page.waitForTimeout(2000);
      const body = await page.textContent("body");
      const saved = body?.includes("Zapamätal som si") && body?.includes("pizza") || false;
      report.push(`"🧠 Zapamätal som si: moje obľúbené jedlo je pizza": ${saved ? "YES" : "NO"}`);
      report.push(saved ? "SUCCESS" : "FAILURE");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step2-memory");

    // STEP 3 - AGENT (new chat, then main textarea)
    report.push("\n========== STEP 3 - AGENT ==========");
    try {
      const newBtn = page.locator('button:has-text("+ Nový")').or(page.locator('button:has-text("Nový chat")')).first();
      if ((await newBtn.count()) > 0) {
        await newBtn.click();
        await page.waitForTimeout(1500);
      }
      const chatInput = page.locator("main textarea").first();
      await chatInput.click();
      await chatInput.fill("Analyzuj koľko súborov je v /Users/jurajmartinkovych/Documents/workspaceAI/jalza/ui/components/ a vypíš ich názvy");
      await page.keyboard.press("Enter");
      await page.getByText(/Agent (spustený|dokončený)/).waitFor({ timeout: 130000 }).catch(() => null);
      await page.waitForTimeout(3000);
      const body = await page.textContent("body");
      const agentBadge = body?.includes("🤖 Agent") || false;
      const steps = body?.includes("Krok 1") || body?.includes("Krok 2") || body?.includes("krokov") || false;
      report.push(`🤖 Agent badge: ${agentBadge ? "YES" : "NO"}`);
      report.push(`Step-by-step (Krok 1, 2...): ${steps ? "YES" : "NO"}`);
      report.push(agentBadge || steps ? "SUCCESS" : "PARTIAL");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step3-agent");

    // STEP 4 - SETTINGS (Push toggle)
    report.push("\n========== STEP 4 - SETTINGS (Push) ==========");
    try {
      const gearBtn = page.locator('button[title="Nastavenia"]').first();
      await gearBtn.click();
      await page.waitForTimeout(2000);
      const body = await page.textContent("body");
      const pushToggle = body?.includes("Push notifikácie") || body?.includes("Push notifik") || false;
      report.push(`"🔔 Push notifikácie" toggle visible: ${pushToggle ? "YES" : "NO"}`);
      report.push(pushToggle ? "SUCCESS" : "NOT FOUND");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    await screenshot("step4-settings");

    const reportPath = path.join(screenshotsDir, "report.txt");
    fs.writeFileSync(reportPath, report.join("\n"));
    console.log(report.join("\n"));
  });
});
