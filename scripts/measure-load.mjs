// Read-only: what a browser actually experiences on a refresh, in a real browser rather
// than a curl that stops at the first byte. "First card" is the number that matters —
// the surface paints nothing until React has hydrated and measured the window, so a fast
// TTFB on its own says nothing about how long the map looks blank.
//
// Run it twice: the first hit after a quiet spell pays a cold start and reads several
// seconds worse than the steady state.
//
//   node scripts/measure-load.mjs [url]
//
// Pair with scripts/measure-reads.ts, which splits the server half of the same number.

import { chromium } from "playwright";

const url = process.argv[2] ?? "https://salonx-mind-map.vercel.app/";

const browser = await chromium.launch();
const page = await browser.newPage();

let transferred = 0;
page.on("response", async (r) => {
  try {
    const len = Number((await r.allHeaders())["content-length"] ?? 0);
    transferred += Number.isFinite(len) ? len : 0;
  } catch {}
});

const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
const domMs = Date.now() - t0;

await page.waitForSelector(".node", { timeout: 120_000 });
const firstCardMs = Date.now() - t0;

await page.waitForLoadState("networkidle", { timeout: 120_000 });
const idleMs = Date.now() - t0;

const cards = await page.locator(".node").count();
const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType("navigation")[0];
  return { ttfb: Math.round(n.responseStart), domContent: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) };
});
const scriptBytes = await page.evaluate(() =>
  performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script").reduce((a, r) => a + (r.transferSize || 0), 0),
);
const docBytes = await page.evaluate(() => {
  const n = performance.getEntriesByType("navigation")[0];
  return n.transferSize || 0;
});

console.log(`url            ${url}`);
console.log(`ttfb           ${nav.ttfb} ms`);
console.log(`domcontent     ${domMs} ms`);
console.log(`first card     ${firstCardMs} ms`);
console.log(`network idle   ${idleMs} ms`);
console.log(`cards          ${cards}`);
console.log(`document       ${Math.round(docBytes / 1024)} KB over the wire`);
console.log(`scripts        ${Math.round(scriptBytes / 1024)} KB over the wire`);

await browser.close();
