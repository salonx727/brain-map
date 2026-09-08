/** What the wire tab actually lists on a given card, and what the map holds. */
import { chromium } from "playwright";

const URL = process.argv[2] || "http://localhost:3011";
const CARD = process.argv[3] || null;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".node", { timeout: 30000 });

const cards = await page.locator(".node").allTextContents();
console.log(`map holds ${cards.length} cards:`);
for (const c of cards) console.log(`   ${c.replace(/\s+/g, " ").trim().slice(0, 60)}`);

const target = CARD ? page.locator(".node", { hasText: CARD }).first() : page.locator(".node").first();
await target.click();
await page.waitForSelector("#panel", { timeout: 10000 });
await page.locator("#panel .strip button", { hasText: "SUB" }).first().click();
await page.waitForTimeout(400);

console.log(`\non card: ${(await page.locator("#panel .title").textContent())?.trim()}`);
console.log(`dropdown: ${(await page.locator("#panel select.f option").allTextContents()).join(" | ")}`);
console.log("existing wires:");
for (const row of await page.locator("#panel .item").allTextContents()) {
  console.log(`   ${row.replace(/\s+/g, " ").trim().slice(0, 90)}`);
}

await browser.close();
