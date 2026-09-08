// Removes what verifying the bridge leaves behind: the probe files uploaded through the
// hub (Storage object and pm_files row) and, optionally, the conversation thread they were
// sent in.
//
// Verification that leaves residue is how this database ended up with 268 test-fixture
// rows once already. Exact prefix match on the probe marker, never a broad LIKE.
//
//   npx tsx --env-file=.env scripts/purge-bridge-probes.ts [--threads]

import { createPmServiceClient } from "../lib/pm/serviceClient";
import * as pmWriter from "../lib/pm/pmWriter";

const MARKER = "bridge-file-probe-";

async function main() {
  const client = createPmServiceClient();

  const { data: files, error } = await client.from("pm_files").select("id, file_name").like("file_name", `${MARKER}%`);
  if (error) throw new Error(`pm_files: ${error.message}`);

  for (const file of files ?? []) {
    // deleteFile removes the Storage object as well as the row — a row deleted on its own
    // would leave the bytes sitting in the bucket forever with nothing pointing at them.
    await pmWriter.deleteFile(client, file.id);
    console.log(`deleted ${file.file_name}`);
  }
  if (!files?.length) console.log("No probe uploads to remove.");

  if (process.argv.includes("--threads")) {
    // ai_messages is ON DELETE CASCADE from ai_threads, so this takes the transcript too.
    const { data, error: tErr } = await client.from("ai_threads").delete().neq("id", "00000000-0000-0000-0000-000000000000").select("id");
    if (tErr) throw new Error(`ai_threads: ${tErr.message}`);
    console.log(`deleted ${data?.length ?? 0} conversation thread(s)`);
  }
}

main();
