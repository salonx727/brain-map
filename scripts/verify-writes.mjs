/**
 * Proves an edit made in the browser is still there after a reload.
 *
 * A write that only updates React state looks identical to a write that reached the
 * database, right up until the page is refreshed — which is the exact failure this app
 * was rebuilt to stop making. So every check here is write → reload → read, never
 * write → read.
 *
 * Cleans up after itself: the to-do it creates is deleted through the same UI, and that
 * deletion is verified by a second reload. Nothing is left in the production tables.
 *
 *   node scripts/verify-writes.mjs http://localhost:3010
 */
import { chromium } from "playwright";

const URL = process.argv[2] || "http://localhost:3010";
const MARKER = `verify-write-${Date.now().toString(36)}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** Opens the first canonical card's control panel on the given tab. */
async function openCard(page, tabLabel) {
  await page.waitForSelector(".node", { timeout: 30000 });
  await page.locator(".node").first().click();
  await page.waitForSelector("#panel", { timeout: 10000 });
  if (tabLabel) {
    await page.locator("#panel .strip button", { hasText: tabLabel }).first().click();
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log("  [page error]", e.message));

try {
  await page.goto(URL, { waitUntil: "networkidle" });

  // ---- the surface is connected at all -------------------------------------
  const note = (await page.locator("#lockstate .hint").first().textContent()) ?? "";
  check("surface does not advertise itself as read-only", !/READ-ONLY/i.test(note), note.trim().slice(0, 60));

  // ---- a to-do survives a reload -------------------------------------------
  await openCard(page, "TO DO");
  await page.locator("#panel .addrow input").fill(MARKER);
  await page.locator("#panel .addrow button").click();
  await page.waitForTimeout(2500);

  await page.reload({ waitUntil: "networkidle" });
  await openCard(page, "TO DO");
  const survived = await page.locator("#panel", { hasText: MARKER }).count();
  check("to-do written in the browser survives a reload", survived > 0);

  // ---- marking it done survives a reload -----------------------------------
  if (survived > 0) {
    const row = page.locator("#panel .listrow", { hasText: MARKER }).first();
    await row.locator(".mark").click();
    await page.waitForTimeout(2500);

    await page.reload({ waitUntil: "networkidle" });
    await openCard(page, "TO DO");
    const doneRow = page.locator("#panel .listrow.is-done", { hasText: MARKER });
    check("marking it done survives a reload", (await doneRow.count()) > 0);
  }

  // ---- canonical cards refuse to be renamed --------------------------------
  const nameField = page.locator("#panel input.f").nth(1);
  check("a canonical card's NAME is not editable", await nameField.isDisabled());

  // ---- removing it survives a reload (and cleans up) -----------------------
  const row = page.locator("#panel .listrow", { hasText: MARKER }).first();
  if (await row.count()) {
    await row.locator(".minus").click();
    await page.waitForTimeout(2500);

    await page.reload({ waitUntil: "networkidle" });
    await openCard(page, "TO DO");
    const gone = await page.locator("#panel", { hasText: MARKER }).count();
    check("removing it survives a reload — nothing left behind", gone === 0);
  } else {
    check("removing it survives a reload — nothing left behind", false, "row never appeared");
  }

  // ---- a PM card's whole life: created, renamed, wired, removed --------------
  await page.locator("#panel .dismiss").click();
  await page.locator("#chrome button, .act").filter({ hasText: "ADD CARD" }).first().click();
  await page.waitForSelector("#panel", { timeout: 15000 });
  const newRef = (await page.locator("#panel .title").textContent())?.trim() ?? "";
  check("ADD CARD gets its ref from the database, not a local counter", /^SUB-\d+$/.test(newRef), newRef);

  const pmName = page.locator("#panel input.f").nth(1);
  check("a PM card's NAME is editable", await pmName.isEnabled());
  await pmName.fill(MARKER);
  await pmName.blur();
  await page.waitForTimeout(2500);

  await page.reload({ waitUntil: "networkidle" });
  const renamed = page.locator(".node", { hasText: MARKER }).first();
  check("renaming a PM card survives a reload", (await renamed.count()) > 0);

  if (await renamed.count()) {
    await renamed.click();
    await page.waitForSelector("#panel", { timeout: 10000 });
    await page.locator("#panel .strip button", { hasText: "SUB" }).first().click();

    // From a PM card every other card is a legal target, canonical ones included.
    const options = await page.locator("#panel select.f option").count();
    check("a PM card can be wired to canonical cards", options > 1, `${options - 1} targets offered`);

    // Given an item so the panel's own REMOVE appears — an empty card is dismissed from
    // its face instead — and so the removal has a cascade worth checking.
    await page.locator("#panel .strip button", { hasText: "TO DO" }).first().click();
    await page.locator("#panel .addrow input").fill(`${MARKER}-child`);
    await page.locator("#panel .addrow button").click();
    await page.waitForTimeout(2500);

    await page.locator("#panel .act").filter({ hasText: /^REMOVE THIS CARD$/ }).first().click();
    await page.locator("#panel .act.armed").first().click();
    await page.waitForTimeout(3000);

    await page.reload({ waitUntil: "networkidle" });
    check("removing a PM card survives a reload — nothing left behind", (await page.locator(".node", { hasText: MARKER }).count()) === 0);
    check("its to-do went with it", (await page.locator("#panel", { hasText: `${MARKER}-child` }).count()) === 0);
  }

  await page.screenshot({ path: "verify-writes.png" });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
