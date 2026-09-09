// End-to-end, against a running dev server: a card drawn on the map opens a ruling on
// Shawn's card, wears the marker, and never claims to be canon.
//
// Retirement is deliberately NOT exercised here — it needs a real canonical arrival, which
// means a real COYOTE edit and a real sync, and faking one would test the fake. That half
// is covered by lib/pm/rulings.test.ts (the matcher) and by the migration's own assertions
// (the retire function refuses a target outside the active snapshot).
//
//   node scripts/verify-ruling-flow.mjs [url]

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3014";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".node", { timeout: 60_000 });

const fail = (msg) => {
  console.log("FAIL:", msg);
  failed = true;
};
let failed = false;

const cardsBefore = await page.locator(".node").count();
const awaitingBefore = await page.locator(".node.awaiting").count();
console.log(`before: ${cardsBefore} cards, ${awaitingBefore} awaiting a ruling`);

// Draw a card from an existing one — the ordinary path, always wired to its parent.
await page.locator(".node").first().click();
await page.waitForSelector("#panel");
const addWired = page.locator("#panel").getByRole("button", { name: "ADD A CARD · WIRED TO THIS ONE" });
await addWired.scrollIntoViewIfNeeded();
await addWired.click();
await page.waitForFunction((n) => document.querySelectorAll(".node").length > n, cardsBefore, { timeout: 30_000 });
await page.waitForTimeout(800);

// The panel that opens after ADD is the new card's — its key is what cleanup removes.
const newKey = await page.locator(".node.awaiting").last().getAttribute("data-id");

const awaitingAfter = await page.locator(".node.awaiting").count();
console.log(`after add: ${await page.locator(".node").count()} cards, ${awaitingAfter} awaiting a ruling`);
if (awaitingAfter !== awaitingBefore + 1) fail("the new card did not open a ruling");

// The panel for the new card must say what it is: on the map, not in canon.
const awaitingNotice = page.locator("#panel").getByText("AWAITING SHAWN’S RULING");
if ((await awaitingNotice.count()) === 0) fail("the new card's panel does not say it is awaiting a ruling");

// Every one of the four §35 intent fields is offered, so a ruling can be phrased in the
// vocabulary Shawn writes canon in.
for (const label of ["DOWNSTREAM", "READS", "EMITS", "TRIGGER"]) {
  if ((await page.locator("#panel").getByText(label, { exact: true }).count()) === 0) {
    fail(`the panel offers no ${label} field`);
  }
}

// The queue itself lives on Shawn's card.
await page.keyboard.press("Escape");
await page.locator('[data-id="owner:shawn"]').click();
await page.waitForSelector("#panel");
const rulingTab = page.locator("#panel").getByRole("button", { name: /^RULING \d+$/ });
if ((await rulingTab.count()) === 0) {
  fail("Shawn's card has no RULING category");
} else {
  await rulingTab.click();
  await page.waitForTimeout(300);
  const rows = await page.locator("#panel .item .mono").count();
  console.log(`Shawn's queue: ${rows} rulings listed`);
  if (rows === 0) fail("the queue is empty after a card was drawn");
  if ((await page.locator("#panel").getByRole("button", { name: /APPROVE/i }).count()) > 0) {
    fail("the queue offers an APPROVE button — canon is written in COYOTE, never tapped here");
  }
}

// Clean up after itself. This runs against the real database, so a card left behind is a
// real card in Shawn's real queue — a verification that quietly adds work to the thing it
// is verifying is worse than no verification.
await page.keyboard.press("Escape");
await page.locator(`[data-id="${newKey}"]`).click();
await page.waitForSelector("#panel");
const remove = page.locator("#panel").getByRole("button", { name: /REMOVE THIS CARD|TAP AGAIN/ });
await remove.scrollIntoViewIfNeeded();
await remove.click();
await remove.click();
await page.waitForTimeout(1500);
const cardsEnd = await page.locator(".node").count();
const awaitingEnd = await page.locator(".node.awaiting").count();
console.log(`after cleanup: ${cardsEnd} cards, ${awaitingEnd} awaiting a ruling`);
if (awaitingEnd !== awaitingBefore) fail("removing the card did not withdraw its ruling");

await browser.close();
console.log(failed ? "RESULT: FAILED" : "RESULT: OK");
if (failed) process.exit(1);
