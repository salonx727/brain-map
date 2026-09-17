import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.setDefaultTimeout(20000);

try {
  await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  const card = page.locator('[data-id="engine:E03"]');
  await card.waitFor({ state: "visible", timeout: 20000 });
  await card.locator("button", { hasText: /^UI/ }).click();
  await page.waitForSelector(".walk", { timeout: 20000 });

  const checks = [];
  async function has(sel, name) {
    const n = await page.locator(sel).count();
    checks.push(`${n > 0 ? "ok  " : "FAIL"} ${name}${n ? ` (${n})` : ""}`);
  }

  await has(".walk-ph", "phone frame");
  await has(".walk-tp", "touch points");
  await has(".walk-grid", "thumbnail grid");
  await has(".walk-thumb-id", "thumbs with ids");
  await has(".walk-thumb-branch", "branch star");
  await has(".walk-mk", "rejoin/exit tiles");
  await has(".walk-flag", "validation flag");

  const ids = await page.locator(".walk-thumb-id").allInnerTexts();
  checks.push(`ids: ${ids.join(",")}`);
  const tiles = await page.locator(".walk-mk").allInnerTexts();
  checks.push(`end tiles: ${JSON.stringify(tiles)}`);
  const legend = await page.locator(".walk-legend").innerText();
  checks.push(`${legend.includes("authored") ? "ok  " : "FAIL"} authored — ${legend.slice(0, 120)}`);
  await page.locator(".walk").screenshot({ path: "scratch-shots-walk/walk-after-html-impl.png" });

  await page.getByRole("button", { name: "Chart", exact: true }).click();
  await has(".walk-chart", "chart view");
  await has(".walk-box", "chart boxes");
  await page.locator(".walk").screenshot({ path: "scratch-shots-walk/walk-chart.png" });
  console.log(checks.join("\n"));
} catch (e) {
  console.error("ERROR", e instanceof Error ? e.message.split("\n")[0] : e);
  await page.screenshot({ path: "scratch-shots-walk/walk-after-html-impl-error.png" }).catch(() => {});
  process.exit(1);
} finally {
  await browser.close();
}
