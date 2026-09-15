// Proves the BRAIN lock on the deployment that actually needs it.
//
// The unit tests in lib/ai/brainGate.test.ts check the logic with a fake cookie jar. This
// checks the thing that matters in practice: that a stranger opening the public map gets
// a passphrase prompt instead of a door onto Shawn's machine, and that the right
// passphrase opens it. Those two facts live in a browser, a real cookie and a deployed
// build, so that is where they get tested.
//
//   node scripts/verify-brain-gate.mjs <url> <passphrase>

import { chromium } from "playwright";

const url = process.argv[2] ?? "https://salonx-mind-map.vercel.app";
const passphrase = process.argv[3];
if (!passphrase) {
  console.error("usage: node scripts/verify-brain-gate.mjs <url> <passphrase>");
  process.exit(2);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** The hub is behind the door on the field, then the AI tab, then the BRAIN engine. */
async function openBrainPanel(page) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator(".door").first().click({ timeout: 60_000 });
  await page.getByRole("button", { name: "AI", exact: true }).first().click({ timeout: 30_000 });
  await page.getByRole("button", { name: "BRAIN", exact: true }).first().click({ timeout: 30_000 });
}

const browser = await chromium.launch();
// A fresh context is the point: no cookie, exactly like a stranger arriving.
const context = await browser.newContext();
const page = await context.newPage();

try {
  await openBrainPanel(page);

  const field = page.locator('input[type="password"]');
  await field.waitFor({ state: "visible", timeout: 30_000 });
  check("a stranger is asked for a passphrase", true);

  const composer = page.getByPlaceholder("Ask it anything, or send a file to read and file");
  check("the composer is not reachable while locked", !(await composer.isVisible().catch(() => false)));

  // Wrong answer first, so a gate that opens for anything would be caught here rather
  // than hidden by the correct one succeeding a moment later.
  await field.fill("definitely-not-the-passphrase");
  await page.getByRole("button", { name: /UNLOCK|CHECKING/ }).click();
  await page.getByText("That is not the passphrase.").waitFor({ timeout: 30_000 });
  check("a wrong passphrase is refused", true);
  check("still locked after a wrong answer", await field.isVisible());

  await field.fill(passphrase);
  await page.getByRole("button", { name: /UNLOCK|CHECKING/ }).click();
  await composer.waitFor({ state: "visible", timeout: 60_000 });
  check("the right passphrase opens the panel", true);

  // The cookie is what carries it, so a reload is the honest test of "remembers".
  await openBrainPanel(page);
  await composer.waitFor({ state: "visible", timeout: 60_000 });
  check("it stays unlocked across a reload", true);

  // And a different browser is still a stranger — the cookie must not be a deployment-wide
  // switch that the first person to unlock flips for everyone.
  const stranger = await browser.newContext();
  const other = await stranger.newPage();
  await openBrainPanel(other);
  await other.locator('input[type="password"]').waitFor({ state: "visible", timeout: 30_000 });
  check("unlocking one browser does not unlock another", true);
  await stranger.close();
} catch (e) {
  check("ran to completion", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
