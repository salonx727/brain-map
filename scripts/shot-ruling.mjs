// Screenshots Shawn's card with the RULING category open — the queue as he actually sees
// it. A map screenshot alone cannot show this: the queue lives behind a tab.
//
//   node scripts/shot-ruling.mjs [url]

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3015";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".node", { timeout: 60_000 });

await page.locator('[data-id="owner:shawn"]').click();
await page.waitForSelector("#panel");
await page.locator("#panel").getByRole("button", { name: /^RULING \d+$/ }).click();
await page.waitForTimeout(500);

await page.screenshot({ path: "ruling-queue.png" });
console.log("screenshot -> ruling-queue.png");
await browser.close();
