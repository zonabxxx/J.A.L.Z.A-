/**
 * J.A.L.Z.A. Business Panel Test (localhost)
 * Run: npx playwright test e2e-business-panel.spec.ts --project=chromium
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:3001";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";

test.describe("J.A.L.Z.A. Business Panel", () => {
  test("Verify Business tab and panel", async ({ page }) => {
    const report: string[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results", "business-panel");
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

    // 3 & 4 - Screenshot sidebar to verify Business tab
    const sidebar = page.locator("aside").first();
    await sidebar.screenshot({ path: path.join(screenshotsDir, "step4-sidebar.png") });
    const body1 = await page.textContent("body");
    const hasBusinessTab = body1?.includes("Business") || body1?.includes("🏢") || false;
    report.push("=== BUSINESS PANEL TEST ===");
    report.push(`Business tab visible in sidebar: ${hasBusinessTab ? "YES" : "NO"}`);

    // 5 & 6 - Click Business tab, wait 10s
    const businessBtn = page.locator('button:has-text("Business")').or(page.locator('button:has-text("🏢")')).first();
    if ((await businessBtn.count()) > 0) {
      await businessBtn.click();
      await page.waitForTimeout(10000);
    } else {
      report.push("Business tab NOT FOUND - cannot click");
    }

    // 7 - Screenshot Business panel content
    await page.screenshot({ path: path.join(screenshotsDir, "step7-business-panel.png") });
    const mainContent = page.locator("main").first();
    await mainContent.screenshot({ path: path.join(screenshotsDir, "step7-business-main.png") }).catch(() => {});

    // 8 - Report
    const body2 = await page.textContent("body");
    const hasBusinessPanel = body2?.includes("Business") || false;
    const hasStats = body2?.includes("Zákazky") || body2?.includes("Faktúry") || body2?.includes("Zákazníci") || body2?.includes("Financie") || body2?.includes("Súhrn") || false;
    const hasError = body2?.toLowerCase().includes("chyba") || body2?.toLowerCase().includes("error") || body2?.includes("nepodarilo") || body2?.includes("nedostupný") || false;
    const hasLoading = body2?.includes("Načítavam") || body2?.includes("loading") || false;

    report.push(`Business panel loads: ${hasBusinessPanel ? "YES" : "NO"}`);
    report.push(`Stats/data visible: ${hasStats ? "YES" : "NO"}`);
    report.push(`Error message: ${hasError ? "YES" : "NO"}`);
    report.push(`Still loading: ${hasLoading ? "YES" : "NO"}`);

    fs.writeFileSync(path.join(screenshotsDir, "report.txt"), report.join("\n"));
    console.log(report.join("\n"));
  });
});
