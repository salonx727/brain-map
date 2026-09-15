// Read-only: the TO DO rows that match no blocker — are their Q-IDs actually absent from
// COYOTE, or is the §00a extractor dropping entries it should be picking up? The two
// answers lead to opposite actions, so this asks the resolved COYOTE text directly.
//
//   npx tsx --env-file=.env scripts/check-orphan-qids.ts

import { readFile } from "node:fs/promises";
import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { getCanonicalGraph } from "../lib/graph/getCanonicalGraph";
import { getWholeBoardPmLayer } from "../lib/graph/getPmLayer";
import { buildModel } from "../lib/adapter";

const Q_ID = /\b(Q-[A-Z0-9][A-Z0-9-]*)\b/g;

async function main() {
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const coyote = await readFile(resolved.source.filePath, "utf8");
  console.log(`coyote: ${resolved.source.fileName}\n`);

  const [canonical, pm] = await Promise.all([getCanonicalGraph(), getWholeBoardPmLayer()]);
  const model = buildModel(canonical.nodes, canonical.connections, pm, new Map(), canonical.diagnostics);

  const onMap = new Set(
    Object.values(model.nodes)
      .flatMap((n) => n.blockers)
      .flatMap((b) => [...`${b.text} ${b.sec}`.matchAll(Q_ID)].map((m) => m[1].toUpperCase())),
  );

  const todoIds = new Set(
    Object.values(model.nodes)
      .flatMap((n) => n.todos)
      .flatMap((t) => [...t.text.matchAll(Q_ID)].map((m) => m[1].toUpperCase())),
  );

  const missing = [...todoIds].filter((id) => !onMap.has(id)).sort();
  const inCoyote: string[] = [];
  const notInCoyote: string[] = [];
  for (const id of missing) (coyote.includes(id) ? inCoyote : notInCoyote).push(id);

  console.log(`Q-IDs named by a TO DO        ${todoIds.size}`);
  console.log(`  already on the map as BLK   ${todoIds.size - missing.length}`);
  console.log(`  not on the map             ${missing.length}`);
  console.log(`    ...but present in COYOTE ${inCoyote.length}   <- extractor is dropping these`);
  console.log(`    ...absent from COYOTE    ${notInCoyote.length}   <- nothing to render them from`);

  if (inCoyote.length) {
    console.log(`\n--- in COYOTE but not reaching BLK ---`);
    for (const id of inCoyote.slice(0, 30)) {
      const at = coyote.indexOf(id);
      const line = coyote.slice(coyote.lastIndexOf("\n", at) + 1, coyote.indexOf("\n", at));
      console.log(`  ${id.padEnd(30)} ${line.trim().slice(0, 90)}`);
    }
    if (inCoyote.length > 30) console.log(`  ... and ${inCoyote.length - 30} more`);
  }
  if (notInCoyote.length) {
    console.log(`\n--- named by a TO DO, absent from COYOTE ---`);
    for (const id of notInCoyote.slice(0, 30)) console.log(`  ${id}`);
    if (notInCoyote.length > 30) console.log(`  ... and ${notInCoyote.length - 30} more`);
  }
}

main();
