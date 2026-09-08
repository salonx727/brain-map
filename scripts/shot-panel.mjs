/** Opens the first card's control panel on a given tab and photographs it. */
import { chromium } from "playwright";

const URL = process.argv[2] || "http://localhost:3010";
const TAB = process.argv[3] || "TO DO";
const OUT = process.argv[4] || "panel.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".node", { timeout: 30000 });
await page.locator(".node").first().click();
await page.waitForSelector("#panel", { timeout: 10000 });
if (TAB !== "-") await page.locator("#panel .strip button", { hasText: TAB }).first().click();
await page.waitForTimeout(600);
await page.locator("#panel").screenshot({ path: OUT });
console.log(`${OUT}  ·  ${(await page.locator("#panel .title").textContent())?.trim()}`);
await browser.close();
