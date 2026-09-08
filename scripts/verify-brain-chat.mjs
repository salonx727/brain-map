// Proves the claim the whole bridge rests on: that the AI hub in this app reaches the
// same agent Telegram reaches, with the vault and the workspace in hand.
//
// It asks a question the map cannot answer. Nothing in Supabase knows what the vault's
// routing table says — if an answer comes back with that in it, the question was answered
// by a process on this machine that read the file, which is the only thing that could
// have. A question about nodes or blockers would have proved nothing: the serverless
// engine can answer those too.
//
// Needs both halves up:
//   apps/salonx-brain-map $ npm run dev -- -p 3014
//   SALONX AIOS           $ COMMAND_WEB_BRIDGE=1 python -m apps.command.run_web_bridge
//
//   node scripts/verify-brain-chat.mjs [url]

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3014";
const QUESTION =
  "Read the vault's CLAUDE.md routing table. In two sentences: where does a partner " +
  "conversation get filed, and what are the two conventions every vault file must follow?";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("[page error]", e.message));

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector(".node", { timeout: 90_000 });

  await page.locator(".door").click();
  await page.waitForSelector("#rosterCard");
  await page.getByRole("button", { name: "AI", exact: true }).click();
  await page.waitForTimeout(1500);

  const engines = await page.getByRole("button", { name: /^(BRAIN|MAP)$/ }).count();
  console.log(`engine buttons: ${engines}`);

  // Counted before sending. The thread is reopened from the database, so it usually
  // already holds a finished exchange — "no longer working" is true the instant the panel
  // opens, and waiting on that alone reads the previous answer and calls it this one.
  const before = await page.locator(".chatlog .turn").count();

  await page.locator("#rosterCard textarea").fill(QUESTION);
  await page.getByRole("button", { name: "SEND", exact: true }).click();

  // The agent may take minutes — it is reading real files, not completing a sentence.
  // The third argument is the options bag; the second is passed to the page function.
  // Given as the second, the 330s becomes an unused argument and the default 30s applies,
  // which times out on every real answer and looks exactly like a broken bridge.
  await page.waitForFunction(
    (n) => {
      const log = document.querySelector(".chatlog");
      const t = log?.textContent ?? "";
      return (log?.querySelectorAll(".turn").length ?? 0) >= n + 2 && !t.includes("Working on it") && !t.includes("Waiting.");
    },
    before,
    { timeout: 330_000 },
  );

  const thread = (await page.locator(".chatlog").textContent()).replace(/\s+/g, " ");
  console.log("---- thread ----");
  console.log(thread.slice(0, 2000));
  await page.locator("#rosterCard").screenshot({ path: "brain-chat.png" });
  console.log("\nscreenshot: brain-chat.png");
} finally {
  await browser.close();
}
