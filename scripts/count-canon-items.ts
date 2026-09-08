// What §15 (blockers) and §00a (open questions) actually yield per engine, straight from
// the resolved COYOTE file. Local-only: reads the markdown, touches no database.
//
//   npx tsx scripts/count-canon-items.ts

import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";
import type { EngineNode } from "../lib/types/canonicalNode";

async function main() {
  const result = await resolveCoyoteSource();
  if (!result.ok) throw new Error(result.diagnostic.message);
  const parsed = parseCanonicalNodes(result.source);

  const engines = parsed.nodes.filter((n): n is EngineNode => n.kind === "engine");

  console.log(`source: ${result.source.fileName}\n`);
  console.log("engine            blockers  questions");
  for (const e of engines) {
    console.log(`${e.nodeKey.padEnd(16)}  ${String(e.blockers.length).padStart(8)}  ${String(e.openQuestions.length).padStart(9)}`);
  }

  const matched = (items: { confidence: string }[]) => items.filter((i) => i.confidence === "matched").length;
  console.log(`\nblockers total ${parsed.blockers.length}  ·  attached to an engine ${matched(parsed.blockers)}  ·  unattributed ${parsed.blockers.length - matched(parsed.blockers)}`);
  console.log(`questions total ${parsed.openQuestions.length}  ·  attached to an engine ${matched(parsed.openQuestions)}  ·  unattributed ${parsed.openQuestions.length - matched(parsed.openQuestions)}`);

  const sample = parsed.blockers.find((b) => b.confidence === "matched");
  if (sample) console.log(`\nexample blocker → ${sample.nodeKey}  [${sample.sourceSection}]  ${sample.text.slice(0, 90)}`);
  const sq = parsed.openQuestions.find((q) => q.confidence === "matched");
  if (sq) console.log(`example question → ${sq.nodeKey}  [${sq.sourceSection}]  ${sq.qId ?? ""} ${sq.status ?? ""} ${sq.text.slice(0, 80)}`);
}

main();
