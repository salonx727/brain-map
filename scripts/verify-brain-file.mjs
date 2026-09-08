// The other half of parity: a file sent from the map lands in front of the same agent, in
// the same place, with the same instruction a file sent from Telegram gets.
//
// It uploads through the app's own Server Action (real Storage, the same `pm-files` bucket
// a card's DROP tab uses), then the bridge downloads it into data/command/inbox/ — which
// is exactly where a Telegram document lands — and hands the agent the workspace-relative
// path with file_intake's wording. If the answer quotes the file's contents, every step of
// that chain ran.
//
// Needs both halves up; see verify-brain-chat.mjs.
//
//   node scripts/verify-brain-file.mjs [url]

import { writeFileSync, unlinkSync } from "node:fs";
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:3014";
const marker = `bridge-file-probe-${Math.random().toString(36).slice(2, 8)}`;
const tmp = `./${marker}.txt`;

writeFileSync(
  tmp,
  [
    "BRIDGE FILE PROBE — not real material, do not file this in the vault.",
    "",
    `Marker: ${marker}`,
    "Secret line: the kettle is on the third shelf.",
  ].join("\n"),
  "utf-8",
);

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

  await page.locator('#rosterCard input[type="file"]').setInputFiles(tmp);
  await page.waitForSelector(".chip", { timeout: 60_000 });
  console.log(`attached: ${await page.locator(".chip").first().innerText()}`);

  // Counted before sending. The thread is reopened from the database, so it usually
  // already holds a finished exchange — "no longer working" is true the instant the panel
  // opens, and waiting on that alone reads the previous answer and calls it this one.
  const before = await page.locator(".chatlog .turn").count();

  await page
    .locator("#rosterCard textarea")
    .fill(
      "This is a bridge test, not real material. Do NOT file it in the vault and do not " +
        "write anything anywhere. Just read it and reply with the secret line it contains.",
    );
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
  console.log(`\nread the file: ${answer.includes("third shelf") ? "YES" : "NO"}`);
  await page.locator("#rosterCard").screenshot({ path: "brain-file.png" });
} finally {
  await browser.close();
  unlinkSync(tmp);
}
