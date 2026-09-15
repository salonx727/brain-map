// Read-only: prints the COYOTE regions that hold Q-IDs the map never renders, so the
// shape can be read before any extractor is pointed at them. Writes nothing, ever —
// COYOTE is Shawn's to write.
//
//   npx tsx --env-file=.env scripts/dump-qid-regions.ts "Open / Held Decisions"

import { readFile } from "node:fs/promises";
import { resolveCoyoteSource } from "../lib/coyote/resolver";

async function main() {
  const needle = process.argv[2];
  if (!needle) throw new Error("pass a string to locate");
  const span = Number(process.argv[3] ?? 30);

  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const lines = (await readFile(resolved.source.filePath, "utf8")).split(/\r?\n/);

  console.log(`coyote: ${resolved.source.fileName}\n`);
  let hits = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(needle)) continue;
    hits++;
    console.log(`===== line ${i + 1} =====`);
    for (let j = Math.max(0, i - 3); j < Math.min(lines.length, i + span); j++) {
      console.log(`${String(j + 1).padStart(6)} ${lines[j]}`);
    }
    console.log();
    if (hits >= 3) break;
  }
  if (!hits) console.log("not found");
}

main();
