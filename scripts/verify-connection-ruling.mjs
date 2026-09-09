// End-to-end, against a running dev server: a wire drawn between two ENGINES — the case
// the database refused outright until 0010 — opens a ruling on Shawn's card, carries a
// paste-ready §35 block, and draws as a proposal rather than as canon.
//
// Retirement is deliberately NOT exercised here, same reasoning as verify-ruling-flow.mjs:
// it needs a real canonical arrival, which means a real COYOTE edit and a real sync, and
// faking one would test the fake. The matcher is covered by lib/pm/connectionRulings.test.ts
// and the retire path by the migration's own guards.
//
//   node scripts/verify-connection-ruling.mjs [url]

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3015";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });

let failed = false;
const fail = (msg) => {
  console.log("FAIL:", msg);
  failed = true;
};

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector(".node", { timeout: 60_000 });

async function queueSize() {
  await page.keyboard.press("Escape");
  await page.locator('[data-id="owner:shawn"]').click();
  await page.waitForSelector("#panel");
  const tab = page.locator("#panel").getByRole("button", { name: /^RULING \d+$/ });
  if ((await tab.count()) === 0) return 0;
  const label = await tab.innerText();
  await page.keyboard.press("Escape");
  return Number(label.replace(/\D+/g, "")) || 0;
}

const queueBefore = await queueSize();
console.log(`before: Shawn's queue holds ${queueBefore}`);

// Two canonical engines. Engine-to-engine is the whole point: §35 is the only author of
// engine-to-engine data flow, and until 0010 the picker would not even offer the pair.
await page.keyboard.press("Escape");
await page.locator('[data-id="engine:E08"]').click();
await page.waitForSelector("#panel");

// Wires live under SUB — the fifth tag, not a tab of its own. See TAGS in lib/seed.ts.
const wireTab = page.locator("#panel .strip button").nth(4);
await wireTab.scrollIntoViewIfNeeded();
await wireTab.click();
await page.waitForTimeout(300);

// SUB holds two rosters — nest-an-existing-card, and this one. Only the wire roster is
// gated on a relation, so it is addressed by its own placeholder rather than by .wirepick.
const wireRoster = page.locator('#panel .wirepick:has(input[placeholder="Search every card on the map…"])');

// No relation picked yet: the roster must not be reachable at all. A wire that could be
// drawn without saying what it means would put a guessed field into a §35 block.
if ((await wireRoster.count()) > 0) {
  fail("the card roster is offered before a relation is picked — a wire must name its §35 field first");
}

await page.locator("#panel").getByRole("button", { name: "DOWNSTREAM" }).first().click();
await page.waitForTimeout(200);
if ((await wireRoster.count()) === 0) {
  fail("picking a relation did not open the card roster");
}

// The pair must now be pickable and marked as a proposal, not disabled as COYOTE's.
const target = wireRoster.locator(".wirepick-row", { hasText: "E09" }).first();
if ((await target.count()) === 0) {
  fail("E09 is not offered as a wire target from E08");
} else {
  const marked = await target.locator(".cap").innerText().catch(() => "");
  console.log(`E09 offered, marked: ${marked || "(none)"}`);
  if (marked.trim() !== "RULING") fail(`an engine-to-engine pair should be marked RULING, got "${marked}"`);
  await target.click();
  await page.waitForTimeout(1800);
}

// The wire now exists, flagged, on the card that drew it.
const pendingChip = page.locator("#panel .cap.ruling");
if ((await pendingChip.count()) === 0) fail("the drawn wire carries no pending-ruling marker on the panel");

const queueAfter = await queueSize();
console.log(`after drawing: Shawn's queue holds ${queueAfter}`);
if (queueAfter !== queueBefore + 1) fail("drawing a wire did not open a ruling on Shawn's card");

// The queue entry itself: the §35 block, written on the right engine's section.
await page.keyboard.press("Escape");
await page.locator('[data-id="owner:shawn"]').click();
await page.waitForSelector("#panel");
await page.locator("#panel").getByRole("button", { name: /^RULING \d+$/ }).click();
await page.waitForTimeout(400);

const blocks = page.locator("#panel .coyote-block");
const blockCount = await blocks.count();
console.log(`queue shows ${blockCount} §35 blocks`);
if (blockCount === 0) fail("the queue shows no §35 block to copy");

// DOWNSTREAM is written on the SOURCE's own section, so the block must be headed E08.
// Headed E09 would mean the parser reads the arrow back the other way on the next sync.
const wireEntry = page.locator("#panel .item", { hasText: "§35 — E08" }).first();
if ((await wireEntry.count()) === 0) {
  const all = await page.locator("#panel .coyote-block").allInnerTexts();
  fail(`no wire ruling headed "§35 — E08" is listed. Blocks in the queue:\n${all.join("\n---\n")}`);
} else {
  const text = await wireEntry.innerText();
  console.log(`queue entry:\n${text}`);
  if (!/DOWNSTREAM:\s*E09/.test(text)) fail("the block does not name E09 as E08's DOWNSTREAM");
  if (!/COPY §35 BLOCK/.test(text)) fail("the queue entry offers no COPY button");
  if (/APPROVE/i.test(text)) fail("the queue offers an APPROVE button — canon is written in COYOTE, never tapped here");
}

await page.screenshot({ path: "shots/connection-ruling.png" });

// Clean up after itself: this runs against the real database, so a wire left behind is a
// real entry in Shawn's real queue. REJECT is the supported removal for a wire, and
// removing it is also the assertion that rejection withdraws the ruling.
const reject = wireEntry.getByRole("button", { name: /REJECT|TAP AGAIN/ });
if ((await reject.count()) > 0) {
  await reject.click();
  await reject.click();
  await page.waitForTimeout(1500);
}

const queueEnd = await queueSize();
console.log(`after cleanup: Shawn's queue holds ${queueEnd}`);
if (queueEnd !== queueBefore) fail("rejecting the wire did not withdraw its ruling");

await browser.close();
console.log(failed ? "RESULT: FAILED" : "RESULT: OK");
if (failed) process.exit(1);
