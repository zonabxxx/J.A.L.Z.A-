/**
 * J.A.L.Z.A. Production - Sidebar tab navigation verification
 * Run: npx playwright test e2e-sidebar-tabs.spec.ts --project=chromium
 */
import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const BASE_URL = "https://jalza-production.up.railway.app";
const SETUP_KEY = "kxzD8HO-uXbtt8cL-PIqMAYCrjmiRJhI";
const TEST_NAME = "Tester";
const TEST_PASSWORD = "Tester123!";

test.describe("J.A.L.Z.A. Sidebar Tabs", () => {
  test("Verify tab navigation", async ({ page }) => {
    const report: string[] = [];
    const screenshotsDir = path.join(process.cwd(), "test-results", "sidebar-tabs");
    fs.mkdirSync(screenshotsDir, { recursive: true });

    test.setTimeout(60000);

    // 1. Go to URL
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForLoadState("domcontentloaded");

    // 2. Login if needed
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

    // 3. Wait 5 seconds for Railway deploy
    await page.waitForTimeout(5000);

    // 4. Screenshot sidebar - focus on tab navigation
    const sidebar = page.locator("aside").first();
    await sidebar.screenshot({ path: path.join(screenshotsDir, "sidebar-tabs-initial.png") });
    await page.screenshot({ path: path.join(screenshotsDir, "full-page-initial.png") });

    // 5. Click different tabs and verify
    const tabs = [
      { name: "Email", selector: 'button:has-text("Email")' },
      { name: "Kalendár", selector: 'button:has-text("Kalendár")' },
      { name: "MCP", selector: 'button:has-text("MCP")' },
      { name: "Spotreba", selector: 'button:has-text("Spotreba")' },
      { name: "Úlohy", selector: 'button:has-text("Úlohy")' },
      { name: "Dashboard", selector: 'button:has-text("📊")' },
    ];

    const tabResults: string[] = [];
    for (const tab of tabs) {
      try {
        const btn = page.locator(tab.selector).first();
        await btn.click();
        await page.waitForTimeout(1500);
        const body = await page.textContent("body");
        const hasContent = body?.toLowerCase().includes(tab.name.toLowerCase()) ||
          (tab.name === "Dashboard" && body?.includes("Dashboard")) ||
          (tab.name === "Dashboard" && body?.includes("📊")) || false;
        tabResults.push(`${tab.name}: ${hasContent ? "OK" : "?"}`);
      } catch (e) {
        tabResults.push(`${tab.name}: FAIL`);
      }
    }

    // 6. Final screenshot
    await page.screenshot({ path: path.join(screenshotsDir, "full-page-final.png") });
    await sidebar.screenshot({ path: path.join(screenshotsDir, "sidebar-tabs-final.png") });

    // Report
    const body = await page.textContent("body");
    const nav = page.locator("nav");
    const hasGrid = await nav.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return style.display === "grid" || style.display === "flex";
    }).catch(() => false);
    const navHtml = await nav.innerHTML().catch(() => "");

    report.push("=== SIDEBAR TAB NAVIGATION REPORT ===");
    report.push(`Grid/flex layout: ${hasGrid || navHtml.includes("grid") ? "YES" : "UNKNOWN"}`);
    report.push(`Icons + labels: ${navHtml.includes("📊") || navHtml.includes("svg") ? "YES" : "UNKNOWN"}`);
    report.push("Tab clicks: " + tabResults.join(", "));
    report.push("Screenshots: sidebar-tabs-initial.png, sidebar-tabs-final.png, full-page-*.png");

    fs.writeFileSync(path.join(screenshotsDir, "report.txt"), report.join("\n"));
    console.log(report.join("\n"));
  });
});
