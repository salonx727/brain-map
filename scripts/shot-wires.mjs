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

await page.getByText("WIRE", { exact: true }).click();
await page.waitForTimeout(600);

const drawn = await page.locator("#wires path").count();
console.log("URL           :", URL);
console.log("wire paths    :", drawn);

const out = `wires-${WIDTH}x${HEIGHT}.png`;
await page.screenshot({ path: out });
console.log("screenshot ->", out);

await browser.close();
