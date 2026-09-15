// Read-only count of what COYOTE still names per engine. The map no longer treats §00a
// as TO DO — that list is typed into pm_items only — but the parse still extracts the
// questions, and this script is how to see them without opening the file. BLK is §15.
//
//   npx tsx scripts/count-coyote-todos.ts

import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";

async function main() {
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const parsed = parseCanonicalNodes(resolved.source);

  console.log(`COYOTE ${resolved.source.fileName}`);
  console.log("");
  console.log("Engine                    TO DO (§00a)  BLK (§15)  total");
  console.log("-".repeat(62));

  let todo = 0;
  let blk = 0;
  for (const n of parsed.nodes.filter((x) => x.kind === "engine")) {
    const t = n.openQuestions.length;
    const b = n.blockers.length;
    todo += t;
    blk += b;
    console.log(`${n.nodeKey.padEnd(14)} ${(n.label ?? "").padEnd(16)} ${String(t).padStart(11)}  ${String(b).padStart(8)}  ${String(t + b).padStart(5)}`);
  }

  const looseQ = parsed.openQuestions.filter((i) => i.confidence !== "matched" || !i.placed);
  const looseB = parsed.blockers.filter((i) => i.confidence !== "matched" || !i.placed);
  console.log("-".repeat(62));
  console.log(`${"on an engine".padEnd(31)} ${String(todo).padStart(11)}  ${String(blk).padStart(8)}  ${String(todo + blk).padStart(5)}`);
  console.log(`${"unattributed / homeless".padEnd(31)} ${String(looseQ.length).padStart(11)}  ${String(looseB.length).padStart(8)}  ${String(looseQ.length + looseB.length).padStart(5)}`);
  console.log(`${"all extracted".padEnd(31)} ${String(parsed.openQuestions.length).padStart(11)}  ${String(parsed.blockers.length).padStart(8)}  ${String(parsed.openQuestions.length + parsed.blockers.length).padStart(5)}`);

  if (looseQ.length) {
    console.log("\n§00a not on an engine:");
    for (const q of looseQ) console.log(`  [${q.qId ?? "?"}] ${q.nodeKey ?? "—"}  ${q.text.slice(0, 110)}`);
  }
  if (looseB.length) {
    console.log("\n§15 not on an engine:");
    for (const b of looseB) console.log(`  ${b.sourceSection}  ${b.text.slice(0, 110)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
