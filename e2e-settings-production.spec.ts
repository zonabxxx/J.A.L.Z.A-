/**
 * J.A.L.Z.A. Settings Modal Test - Production
 * Run: npx playwright test e2e-settings-production.spec.ts --project=chromium
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.JALZA_BASE_URL || "https://jalza-production.up.railway.app";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";

test.describe("J.A.L.Z.A. Settings Modal (Production)", () => {
  test("Full settings modal test with screenshots at each step", async ({ page }) => {
    const report: string[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results", "settings-production");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    test.setTimeout(120000);

    // STEP 1 & 2 - Navigate and login
    report.push("=== STEP 1-2: NAVIGATE & LOGIN ===");
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(8000); // Railway cold start

    await page.screenshot({ path: path.join(screenshotsDir, "step1-initial.png") });

    const loginInput = page.locator('input[name="username"], input[placeholder="Meno"]');
    if ((await loginInput.count()) > 0) {
      const loginSwitchBtn = page.locator('button:has-text("Už mám účet? Prihlásiť sa")');
      if ((await loginSwitchBtn.count()) > 0) {
        await loginSwitchBtn.click();
        await page.waitForTimeout(1000);
      }
      await loginInput.first().fill(TEST_NAME);
      await page.locator('input[placeholder*="Heslo"], input[type="password"]').first().fill(TEST_PASSWORD);
      await page.locator('button:has-text("Prihlásiť sa")').or(page.locator('button[type="submit"]')).first().click();
      await page.waitForTimeout(8000);
      if ((await page.locator('text=Používateľ s týmto menom už existuje').count()) > 0) {
        await page.locator('button:has-text("Už mám účet? Prihlásiť sa")').click();
        await page.waitForTimeout(500);
        await loginInput.first().fill(TEST_NAME);
        await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
        await page.locator('button:has-text("Prihlásiť sa")').click();
        await page.waitForTimeout(8000);
      }
    }

    const asideVisible = await page.locator("aside").isVisible().catch(() => false);
    await page.screenshot({ path: path.join(screenshotsDir, "step2-after-login.png") });

    if (!asideVisible) {
      const errText = await page.locator('.bg-red-500\\/10, [class*="error"], [class*="text-red"]').first().textContent().catch(() => "");
      report.push(`LOGIN FAILED: ${errText || "aside not visible - backend may be unreachable (fetch failed)"}`);
      report.push("Screenshots taken: step1-initial.png, step2-after-login.png");
      fs.writeFileSync(path.join(screenshotsDir, "report.txt"), report.join("\n"));
      console.log(report.join("\n"));
      return;
    }
    report.push("Logged in successfully");

    // STEP 3 & 4 - Open settings modal, screenshot FULL modal
    report.push("\n=== STEP 3-4: OPEN SETTINGS MODAL ===");
    const settingsBtn = page.locator('aside button[title="Nastavenia"]').first();
    await settingsBtn.click();
    await page.waitForTimeout(2000);

    const modal = page.locator('div.fixed.inset-0.z-50');
    await modal.waitFor({ state: "visible", timeout: 5000 });
    await page.screenshot({ path: path.join(screenshotsDir, "step4-settings-modal-full.png") });
    report.push("Settings modal opened, full screenshot taken");

    // STEP 5 & 6 & 7 - Check content, click push toggle, screenshot
    report.push("\n=== STEP 5-7: CHECK CONTENT & PUSH TOGGLE ===");
    const body1 = await page.textContent("body");
    const hasProfile = body1?.includes("Odhlásiť") || body1?.includes("Role:") || false;
    const hasFeatureToggles = body1?.includes("Funkcie") || body1?.includes("Automatický routing") || false;
    const hasPushToggle = body1?.includes("Push notifikácie") || body1?.includes("🔔") || false;

    report.push(`Profile visible: ${hasProfile ? "YES" : "NO"}`);
    report.push(`Feature toggles visible: ${hasFeatureToggles ? "YES" : "NO"}`);
    report.push(`Push notification toggle visible: ${hasPushToggle ? "YES" : "NO"}`);

    const pushSection = page.locator('section:has-text("Push notifikácie")');
    const pushToggleBtn = pushSection.locator('button').first();
    const pushToggleCount = await pushToggleBtn.count();

    if (pushToggleCount > 0) {
      report.push("Push toggle: attempting click...");
      try {
        await pushToggleBtn.click();
        await page.waitForTimeout(1500);
        report.push("Push toggle clicked successfully");
      } catch (e) {
        report.push(`Push toggle click failed: ${String(e)}`);
      }
    } else {
      report.push("Push toggle: NOT FOUND (push may not be supported in this browser)");
    }

    await page.screenshot({ path: path.join(screenshotsDir, "step7-after-push-toggle.png") });

    // STEP 8 & 9 - Click Znalostné bázy, screenshot
    report.push("\n=== STEP 8-9: ZNALOSTNÉ BÁZY TAB ===");
    const znalostneBtn = page.locator('button:has-text("Znalostné bázy")');
    await znalostneBtn.click();
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(screenshotsDir, "step9-znalostne-bazy.png") });

    const body2 = await page.textContent("body");
    const hasAgentsList = body2?.includes("zdrojov") || body2?.includes("častí") || body2?.includes("ADsun") || body2?.includes("Žiadne zdroje") || body2?.includes("Pridaj URL") || false;
    report.push(`Knowledge base agents listed: ${hasAgentsList ? "YES" : "NO"}`);

    report.push("\n=== FULL REPORT ===");
    report.push("Screenshots: step1-initial, step2-after-login, step4-settings-modal-full, step7-after-push-toggle, step9-znalostne-bazy");

    fs.writeFileSync(path.join(screenshotsDir, "report.txt"), report.join("\n"));
    console.log(report.join("\n"));
  });
});
