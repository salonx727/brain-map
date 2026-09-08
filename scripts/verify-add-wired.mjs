import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3014";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".node", { timeout: 60_000 });

const twoDBefore = await page.locator("#wires path").count();
const cardsBefore = await page.locator(".node").count();
console.log(`before: ${cardsBefore} cards, ${twoDBefore} 2D wires`);
if (twoDBefore !== 0) {
  console.log("FAIL: 2D map should not draw wires");
  await browser.close();
  process.exit(1);
}

await page.locator(".node").first().click();
await page.waitForSelector("#panel");
await page.locator("#panel").getByRole("button", { name: "ADD A CARD · WIRED TO THIS ONE" }).scrollIntoViewIfNeeded();
await page.locator("#panel").getByRole("button", { name: "ADD A CARD · WIRED TO THIS ONE" }).click();
await page.waitForFunction(
  (n) => document.querySelectorAll(".node").length > n,
  cardsBefore,
  { timeout: 30_000 },
);
await page.waitForTimeout(800);
const twoDAfter = await page.locator("#wires path").count();
const cardsAfter = await page.locator(".node").count();
console.log(`after add: ${cardsAfter} cards, ${twoDAfter} 2D wires`);

const added = cardsAfter > cardsBefore && twoDAfter === 0;
if (!added) {
  console.log("FAIL: new card missing, or 2D wires appeared");
}

const del = page.getByRole("button", { name: "REMOVE THIS CARD" });
if (await del.count()) {
  await del.click();
  await del.click();
  await page.waitForTimeout(1200);
}
const cardsEnd = await page.locator(".node").count();
console.log(`after delete: ${cardsEnd} cards`);
await browser.close();
if (!added) process.exit(1);
