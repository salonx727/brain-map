// Layout check for the hub: the card stays put, only the thread / unrouted list scrolls.
//
//   node scripts/verify-hub-layout.mjs [url]

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3014";

async function measure(page) {
  return page.evaluate(() => {
    const card = document.querySelector("#rosterCard");
    const log = document.querySelector(".chatlog");
    const composer = document.querySelector(".composer");
    const intake = document.querySelector(".intake");
    const cs = card ? getComputedStyle(card) : null;
    return {
      cardH: card?.getBoundingClientRect().height ?? 0,
      cardOverflow: cs?.overflowY ?? null,
      cardScrollH: card?.scrollHeight ?? 0,
      cardClientH: card?.clientHeight ?? 0,
      logOverflow: log ? getComputedStyle(log).overflowY : null,
      logH: log?.getBoundingClientRect().height ?? 0,
      composerVisible: composer ? composer.getBoundingClientRect().bottom <= window.innerHeight : false,
      intakeVisible: intake ? intake.getBoundingClientRect().top > 0 : false,
    };
  });
}

const browser = await chromium.launch();

async function pass(label, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".node", { timeout: 60_000 });
  await page.locator(".door").click();
  await page.waitForSelector("#rosterCard");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.waitForTimeout(800);

  const ai = await measure(page);
  await page.locator("#rosterCard").screenshot({ path: `hub-ai-${label}.png` });

  await page.getByRole("button", { name: "MAP", exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator("#rosterCard").screenshot({ path: `hub-map-${label}.png` });

  await page.getByRole("button", { name: "INTAKE", exact: true }).click();
  await page.waitForTimeout(400);
  const intake = await measure(page);
  await page.locator("#rosterCard").screenshot({ path: `hub-intake-${label}.png` });

  await page.close();
  return { ai, intake };
}

const desktop = await pass("desktop", { width: 1400, height: 900 });
const mobile = await pass("mobile", { width: 390, height: 844 });

await browser.close();

function report(name, { ai, intake }) {
  const sameH = Math.abs(ai.cardH - intake.cardH) < 2;
  const cardDoesNotScroll = ai.cardOverflow === "hidden" && ai.cardScrollH <= ai.cardClientH + 2;
  const listScrolls = ai.logOverflow === "auto" || ai.logOverflow === "scroll";
  console.log(`\n${name}`);
  console.log(`  card height AI=${Math.round(ai.cardH)} intake=${Math.round(intake.cardH)} same=${sameH}`);
  console.log(`  card overflow=${ai.cardOverflow} card-scrolls=${!cardDoesNotScroll}`);
  console.log(`  chatlog overflow=${ai.logOverflow} scrolls=${listScrolls}`);
  console.log(`  composer visible=${ai.composerVisible} intake buttons visible=${intake.intakeVisible}`);
  return sameH && cardDoesNotScroll && listScrolls && ai.composerVisible && intake.intakeVisible;
}

const ok = report("desktop", desktop) && report("mobile", mobile);
if (!ok) process.exit(1);
console.log("\nlayout ok");
