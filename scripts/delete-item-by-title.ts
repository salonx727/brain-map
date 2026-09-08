// Delete pm_items rows whose title matches exactly. Written for one job: removing the
// probe row an end-to-end AI-hub verification writes, so that verifying the write path
// does not leave the production board carrying the evidence.
//
// Exact-match only, and it prints what it removed. A LIKE pattern here would eventually
// delete somebody's real to-do because it happened to share a prefix.
//
//   npx tsx --env-file=.env scripts/delete-item-by-title.ts "ai-hub-proposal-probe"

import { createPmServiceClient } from "../lib/pm/serviceClient";

async function main() {
  const title = process.argv[2];
  if (!title) throw new Error("Pass the exact title to delete.");

  const client = createPmServiceClient();
  const { data, error } = await client.from("pm_items").delete().eq("title", title).select("id, title, node_key");
  if (error) throw new Error(error.message);

  if (!data?.length) {
    console.log(`No pm_items row titled ${JSON.stringify(title)}.`);
    return;
  }
  for (const row of data) console.log(`deleted ${row.id} — ${row.title} (${row.node_key ?? "no card"})`);
}

main();
