// Loads the surface and reports what actually happens in the browser: uncaught errors,
// console errors, how many cards ended up in the DOM, and what the body measures. A blank
// page has a cause, and guessing at it from source is how the wrong thing gets fixed.
import { chromium } from "playwright";

const URL = process.argv[2] || "http://localhost:3003";
const WIDTH = Number(process.argv[3] ?? 1440);
const HEIGHT = Number(process.argv[4] ?? 900);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("CONSOLE: " + m.text());
});
page.on("requestfailed", (r) => errors.push("REQFAIL: " + r.url() + " " + (r.failure()?.errorText ?? "")));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const shape = await page.evaluate(() => ({
  bodyHeight: Math.round(document.body.getBoundingClientRect().height),
  bodyChildren: document.body.children.length,
  nodes: document.querySelectorAll(".node").length,
  viewport: !!document.getElementById("viewport"),
  bar: !!document.getElementById("bar"),
  firstNodeId: document.querySelector(".node")?.id ?? null,
  bodyTextStart: document.body.innerText.slice(0, 200),
}));

console.log("URL              :", URL);
console.log("body height      :", shape.bodyHeight);
console.log("body children    :", shape.bodyChildren);
console.log("card count       :", shape.nodes);
console.log("#viewport present:", shape.viewport);
console.log("#bar present     :", shape.bar);
console.log("first card id    :", shape.firstNodeId);
console.log("visible text     :", JSON.stringify(shape.bodyTextStart));
console.log("");
console.log(errors.length === 0 ? "no errors captured" : "ERRORS (" + errors.length + "):");
for (const e of errors.slice(0, 12)) console.log("  " + e);

const shot = `debug-${WIDTH}x${HEIGHT}.png`;
await page.screenshot({ path: shot, fullPage: false });
console.log("");
console.log("screenshot -> " + shot);

await browser.close();
