// Read-only: the console and page errors a real browser hits on load. A page that returns
// 200 and still draws nothing has failed during hydration, and this is where that says so.
//
//   node scripts/peek-browser-errors.mjs [url]

import { chromium } from "playwright";

const url = process.argv[2] ?? "https://salonx-mind-map.vercel.app/";
const browser = await chromium.launch();
const page = await browser.newPage();

page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}] ${m.text().slice(0, 400)}`);
});
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message.slice(0, 600)}`));

await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForTimeout(3000);

console.log(`\ncards   ${await page.locator(".node").count()}`);
console.log(`body    ${(await page.locator("body").innerText()).slice(0, 300).replace(/\n+/g, " | ")}`);

await browser.close();
