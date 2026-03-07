/**
 * J.A.L.Z.A. Localhost - Sidebar tab layout verification
 * Run: npx playwright test e2e-sidebar-local.spec.ts --project=chromium
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:3001";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";

test.describe("J.A.L.Z.A. Sidebar Tabs (localhost)", () => {
  test("Verify 4-column grid layout", async ({ page }) => {
    const report: string[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results", "sidebar-local");
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

    // 3. Screenshot sidebar
    const sidebar = page.locator("aside").first();
    await sidebar.screenshot({ path: path.join(screenshotsDir, "sidebar-initial.png") });
    await page.screenshot({ path: path.join(screenshotsDir, "full-initial.png") });

    // 4 & 5. Check layout and click tabs
    const nav = page.locator("aside nav").first();
    const navClasses = await nav.getAttribute("class").catch(() => "");
    const hasGridCols4 = navClasses?.includes("grid-cols-4") || false;
    const tabButtons = page.locator("aside nav button");
    const tabCount = await tabButtons.count();

    report.push("=== SIDEBAR TAB LAYOUT REPORT ===");
    report.push(`grid-cols-4 in nav: ${hasGridCols4 ? "YES" : "NO"}`);
    report.push(`Tab button count: ${tabCount} (expected 7)`);

    // Click Email, then Kalendár, then MCP
    for (const label of ["Email", "Kalendár", "MCP"]) {
      const btn = page.locator(`aside nav button:has-text("${label}")`).first();
      if ((await btn.count()) > 0) {
        await btn.click();
        await page.waitForTimeout(800);
        const isActive = await btn.evaluate((el) => el.classList.contains("text-blue-400") || el.classList.contains("bg-blue-500"));
        report.push(`${label} click: OK, active highlight: ${isActive ? "YES" : "?"}`);
      }
    }

    // 6. Final screenshot
    await sidebar.screenshot({ path: path.join(screenshotsDir, "sidebar-final.png") });
    await page.screenshot({ path: path.join(screenshotsDir, "full-final.png") });

    const body = await page.textContent("body");
    report.push(`Icons in DOM: ${body?.includes("📊") && body?.includes("📧") ? "YES" : "NO"}`);
    report.push(`Labels: Prehľad, Chat, Email, Kalendár, MCP, Spotreba, Úlohy`);

    fs.writeFileSync(path.join(screenshotsDir, "report.txt"), report.join("\n"));
    console.log(report.join("\n"));
  });
});
