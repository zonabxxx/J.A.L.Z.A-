/**
 * J.A.L.Z.A. Agent Feature E2E Test (localhost)
 * Run: npx playwright test e2e-agent-test.spec.ts --project=chromium
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:3001";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";
const AGENT_PROMPT = "Analyzuj aké komponenty má jalza UI a vytvor krátky report";

test.describe("J.A.L.Z.A. Agent Feature", () => {
  test("Agent task: analyze jalza UI components", async ({ page }) => {
    const report: string[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results", "agent-test");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    test.setTimeout(300000); // 5 min (3 min agent wait + buffer)

    const sendMessage = async () => {
      await page.locator("textarea").first().click();
      await page.keyboard.press("Enter");
    };

    // STEP 1 - LOGIN
    report.push("=== STEP 1 - LOGIN ===");
    try {
      await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForLoadState("domcontentloaded");

      // Wait for page to finish loading (skip "Overujem zabezpečenie...")
      await page.waitForTimeout(3000);
      const loginInput = page.locator('input[name="username"], input[placeholder="Meno"]');
      const hasLoginForm = (await loginInput.count()) > 0;
      if (hasLoginForm) {
        await loginInput.first().fill(TEST_NAME);
        const setupKeyInput = page.locator('input[placeholder="Registračný kľúč"]');
        if ((await setupKeyInput.count()) > 0) {
          await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
          await setupKeyInput.fill(SETUP_KEY);
        } else {
          await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
        }
        await page.waitForTimeout(300);
        await page.locator('button[type="submit"]').click();
        await page.waitForTimeout(2000);
        const userExists = await page.locator('text=Používateľ s týmto menom už existuje').count() > 0;
        if (userExists) {
          await page.locator('button:has-text("Už mám účet? Prihlásiť sa")').click();
          await page.waitForTimeout(500);
          await loginInput.first().fill(TEST_NAME);
          await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
          await page.locator('button[type="submit"]').click();
        }
        // If still on login (invalid credentials), try setup key as password
        const stillLogin = await page.locator('text=Neplatné prihlasovacie údaje').count() > 0;
        if (stillLogin) {
          await page.locator('input[type="password"]').first().fill(SETUP_KEY);
          await page.locator('button[type="submit"]').click();
        }
      }
      await page.waitForSelector("textarea", { timeout: 20000 });
      report.push("SUCCESS: Logged in or already in chat");
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    try {
      await page.screenshot({ path: path.join(screenshotsDir, "step1-login.png") });
    } catch {}

    // Ensure main chat - click Chat tab and J.A.L.Z.A. (všeobecný)
    const chatTab = page.locator('button:has-text("Chat")').first();
    if (await chatTab.count() > 0) {
      await chatTab.click();
      await page.waitForTimeout(500);
    }
    const generalAgent = page.locator('button:has-text("J.A.L.Z.A. (všeobecný)"), [role="button"]:has-text("J.A.L.Z.A. (všeobecný)")').first();
    if (await generalAgent.count() > 0) {
      await generalAgent.click();
      await page.waitForTimeout(1000);
    }

    // STEP 2 - SEND AGENT TASK
    report.push("\n=== STEP 2 - AGENT TASK ===");
    const stepStart = Date.now();
    try {
      const textarea = page.locator("textarea").first();
      await textarea.fill(AGENT_PROMPT);
      await sendMessage();

      // Wait for "Agent spustený" (confirms agent route) or "Agent dokončený" (full result) - up to 3 min
      await page.getByText(/Agent (spustený|dokončený)/).waitFor({ timeout: 185000 }).catch(() => null);
      // Extra wait for full result to render
      await page.waitForTimeout(3000);

      // Wait a bit more for full response
      await page.waitForTimeout(5000);

      const body = await page.textContent("body");
      const hasAgentBadge = body?.includes("🤖 Agent") || body?.includes("Agent") || false;
      const hasAgentSpusteny = body?.includes("Agent spustený") || false;
      const hasAgentDokonceny = body?.includes("Agent dokončený") || false;
      const hasJalzaBadge = body?.includes("J.A.L.Z.A.") && !body?.includes("🤖 Agent") ? true : false;
      const hasSteps = body?.includes("Krok 1") || body?.includes("Krok 2") || body?.includes("krokov") || false;
      const hasToolUsage = body?.includes("list_files") || body?.includes("shell") || body?.includes("read_file") || false;
      const hasFinalResult = body?.includes("Výsledok") || body?.includes("report") || body?.includes("komponent") || false;

      const duration = Date.now() - stepStart;
      report.push(`Duration: ${Math.round(duration / 1000)}s`);
      report.push(`🤖 Agent badge in response: ${hasAgentBadge ? "YES" : "NO"}`);
      report.push(`"Agent spustený" shown: ${hasAgentSpusteny ? "YES" : "NO"}`);
      report.push(`"Agent dokončený" shown: ${hasAgentDokonceny ? "YES" : "NO"}`);
      report.push(`J.A.L.Z.A. route (not Agent): ${hasJalzaBadge ? "YES - classifier may have routed to regular chat" : "NO"}`);
      report.push(`Step-by-step (Krok 1, 2...): ${hasSteps ? "YES" : "NO"}`);
      report.push(`Tool usage (list_files, shell...): ${hasToolUsage ? "YES" : "NO"}`);
      report.push(`Final result/report: ${hasFinalResult ? "YES" : "NO"}`);
    } catch (e) {
      report.push(`FAILURE: ${e}`);
    }
    try {
      await page.screenshot({ path: path.join(screenshotsDir, "step2-agent-response.png") });
    } catch {}

    // STEP 3 - VERIFY AGENT STEPS
    report.push("\n=== STEP 3 - VERIFY AGENT STEPS ===");
    let body3 = "";
    try {
      body3 = (await page.textContent("body")) || "";
    } catch {}
    const checks = {
      "Agent dokončený or Agent spustený": body3?.includes("Agent dokončený") || body3?.includes("Agent spustený") || false,
      "Step-by-step (Krok 1, 2...)": body3?.includes("Krok 1") || body3?.includes("Krok 2") || body3?.includes("krokov") || false,
      "Tool usage (list_files, shell...):": body3?.includes("list_files") || body3?.includes("shell") || body3?.includes("read_file") || false,
      "Final result/report": body3?.includes("Výsledok") || body3?.includes("report") || body3?.toLowerCase().includes("komponent") || false,
    };
    for (const [label, ok] of Object.entries(checks)) {
      report.push(`  ${label}: ${ok ? "✓" : "✗"}`);
    }

    const reportPath = path.join(screenshotsDir, "agent-test-report.txt");
    try {
      fs.writeFileSync(reportPath, report.join("\n"));
      console.log("\n" + report.join("\n"));
    } catch {}
  });
});
