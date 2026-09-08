// Screenshots the surface with wire mode ON. The canvas hides every edge behind the WIRE
// toggle by design, so a plain screenshot of the map looks identical whether the graph has
// twenty-two edges or none — which is exactly how an empty canonical_connections table
// went unnoticed.
//
//   node scripts/shot-wires.mjs [url] [width] [height]

import { chromium } from "playwright";

const URL = process.argv[2] || "http://localhost:3007";
const WIDTH = Number(process.argv[3] ?? 1600);
const HEIGHT = Number(process.argv[4] ?? 1000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
await page.goto(URL, { waitUntil: "networkidle" });

const twoD = await page.locator("#wires path").count();
await page.getByText("WIRE", { exact: true }).click();
await page.waitForSelector("#field3d.open", { timeout: 10_000 });
await page.waitForTimeout(600);

console.log("URL           :", URL);
console.log("2D wire paths :", twoD);
console.log("3D canvas     :", (await page.locator("#field3d.open").count()) > 0);

const out = `wires-${WIDTH}x${HEIGHT}.png`;
await page.screenshot({ path: out });
console.log("screenshot ->", out);

await browser.close();
