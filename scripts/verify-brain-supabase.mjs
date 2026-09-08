// The last thing the agent could not see.
//
// The vault and the workspace are files, so the agent has always been able to read them.
// The map is Postgres, and it was the one part of Salon X the brain was blind to — it
// could describe every engine and not tell you whether the map had been published to
// this week. scripts/read-supabase.ts gives it a read-only way in, and worker.py's system
// prompt tells it that the script exists.
//
// This asks a question with a number in the answer that appears nowhere in any file. If
// it comes back right, the agent found the script, ran it, and read the row.
//
//   node scripts/verify-brain-supabase.mjs [url]

import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3014";
const QUESTION =
  "Using the read-only Supabase reader in apps/salonx-brain-map, tell me in two lines: " +
  "which COYOTE file the Visual Brain is currently publishing, and how many canonical " +
  "nodes and connections are live.";

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

  const before = await page.locator(".chatlog .turn").count();
  await page.locator("#rosterCard textarea").fill(QUESTION);
  await page.getByRole("button", { name: "SEND", exact: true }).click();

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
  const answer = thread.slice(thread.lastIndexOf("BRAIN"));
  console.log("---- answer ----");
  console.log(answer.slice(0, 1200));
  // 172 and 66 are rows in Postgres and are written down in no file anywhere.
  console.log(`\nread the database: ${answer.includes("172") && answer.includes("66") ? "YES" : "NO"}`);
  await page.locator("#rosterCard").screenshot({ path: "brain-supabase.png" });
} finally {
  await browser.close();
}
