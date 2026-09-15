// Read-only: what the live map renders in TO DO and BLK, counted in the browser rather
// than inferred from the database. The ruling is TO DO empty, BLK carrying every COYOTE
// line, and this is the only place that can confirm both at once.
//
//   node scripts/verify-map-lists.mjs [url]

import { chromium } from "playwright";

const url = process.argv[2] ?? "https://salonx-mind-map.vercel.app/";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForSelector(".node", { timeout: 120_000 });

// The counts the cards themselves show, read off their controls.
const chips = await page.$$eval(".node .ctl", (els) =>
  els.map((e) => ({ label: e.textContent?.replace(/\s+/g, " ").trim() ?? "" })),
);

const tally = new Map();
for (const { label } of chips) {
  const m = label.match(/^(TO DO|BLK|NOTE|DROP|SUB|REF)\s*(\d+)?/);
  if (!m) continue;
  const key = m[1];
  tally.set(key, (tally.get(key) ?? 0) + Number(m[2] ?? 0));
}

console.log(`url    ${url}`);
console.log(`cards  ${await page.locator(".node").count()}`);
for (const [k, n] of tally) console.log(`${k.padEnd(7)} ${n}`);

await browser.close();
