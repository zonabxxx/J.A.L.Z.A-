/**
 * J.A.L.Z.A. Settings Modal Test (localhost)
 * Run: npx playwright test e2e-settings-modal.spec.ts --project=chromium
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:3001";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";

test.describe("J.A.L.Z.A. Settings Modal", () => {
  test("Verify settings modal and Znalostné bázy tab", async ({ page }) => {
    const report: string[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results", "settings-modal");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    test.setTimeout(45000);

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
    await page.waitForSelector("aside", { timeout: 15000 });

    // 3 - Click gear icon (settings button in bottom-left of sidebar, near user avatar)
    const settingsBtn = page.locator('aside button[title="Nastavenia"]').or(
      page.locator('aside button').filter({ has: page.locator('svg') }).last()
    );
    await settingsBtn.first().click();
    await page.waitForTimeout(1500);

    // 4 - Screenshot settings modal
    const modal = page.locator('div.fixed.inset-0.z-50');
    await modal.waitFor({ state: "visible", timeout: 5000 });
    await page.screenshot({ path: path.join(screenshotsDir, "step4-settings-modal.png") });

    // 5 - Report on modal content
    const body1 = await page.textContent("body");
    const hasModal = body1?.includes("Nastavenia") || false;
    const hasProfile = body1?.includes("Odhlásiť") || body1?.includes("Role:") || false;
    const hasFeatureToggles = body1?.includes("Funkcie") || body1?.includes("Automatický routing") || body1?.includes("Web Search") || false;
    const hasPushToggle = body1?.includes("Push notifikácie") || body1?.includes("🔔") || false;
    const hasAutoUpdate = body1?.includes("Automatický update znalostí") || body1?.includes("Povolený") || false;

    report.push("=== SETTINGS MODAL TEST ===");
    report.push(`Modal showing content: ${hasModal ? "YES" : "NO"}`);
    report.push(`Profile section visible: ${hasProfile ? "YES" : "NO"}`);
    report.push(`Feature toggles visible: ${hasFeatureToggles ? "YES" : "NO"}`);
    report.push(`Push notifications toggle: ${hasPushToggle ? "YES" : "NO"}`);
    report.push(`Auto-update settings: ${hasAutoUpdate ? "YES" : "NO"}`);

    // 6 - Click "Znalostné bázy" tab
    const znalostneBtn = page.locator('button:has-text("Znalostné bázy")');
    await znalostneBtn.click();
    await page.waitForTimeout(2000);

    // 7 - Screenshot Znalostné bázy tab
    await page.screenshot({ path: path.join(screenshotsDir, "step7-znalostne-bazy.png") });

    // 8 - Report on knowledge base agents
    const body2 = await page.textContent("body");
    const hasZnalostneTab = body2?.includes("Znalostné bázy") || false;
    const hasAgentsList = body2?.includes("zdrojov") || body2?.includes("častí") || body2?.includes("ADsun") || body2?.includes("Žiadne zdroje") || body2?.includes("Pridaj URL") || false;

    report.push("");
    report.push("=== ZNALOSTNÉ BÁZY TAB ===");
    report.push(`Znalostné bázy tab active: ${hasZnalostneTab ? "YES" : "NO"}`);
    report.push(`Knowledge base agents list visible: ${hasAgentsList ? "YES" : "NO"}`);

    fs.writeFileSync(path.join(screenshotsDir, "report.txt"), report.join("\n"));
    console.log(report.join("\n"));
  });
});
