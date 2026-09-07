// Prints the real captured TRIGGER/READS/WRITES/DOWNSTREAM values for the engines whose
// edges the sheet draws but the parser misses. Written because connections.ts's header
// warns that these fields carry false positives ("booking off a Cube share" reading as
// INT BOOKING), and that warning has to be checked against the actual text before any
// matching rule is chosen.
//
//   npx tsx --env-file=.env scripts/dump-fields.ts E01 E07 E10

import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";
import type { EngineNode } from "../lib/types/canonicalNode";

const WANTED = (process.argv.slice(2).length ? process.argv.slice(2) : ["E01", "E07", "E10"]).map((r) => `engine:${r}`);

function show(label: string, field: { state: string; value?: string }) {
  if (field.state !== "present") {
    console.log(`  ${label}: <${field.state}>`);
    return;
  }
  const firstParagraph = (field.value ?? "").split(/\n\s*\n/)[0];
  console.log(`  ${label}: ${JSON.stringify(firstParagraph.slice(0, 600))}`);
}

async function main() {
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);

  // --raw <marker>: the surrounding source text, for fields the extractor does not
  // capture at all (EMITS AT SESSION CLOSE is only a terminator today, so its content
  // appears in no parsed field and can only be read here).
  const rawIndex = process.argv.indexOf("--raw");
  if (rawIndex !== -1) {
    const marker = process.argv[rawIndex + 1];
    const text = resolved.source.text;
    const at = text.indexOf(marker);
    if (at === -1) {
      console.log(`marker ${JSON.stringify(marker)} not found`);
      return;
    }
    console.log(text.slice(at - 200, at + 2200));
    return;
  }

  const parsed = parseCanonicalNodes(resolved.source);
  console.log("source:", resolved.source.fileName, "\n");

  for (const node of parsed.nodes) {
    if (node.kind !== "engine" || !WANTED.includes(node.nodeKey)) continue;
    const e = node as EngineNode;
    console.log(`=== ${e.nodeKey} — ${e.label} ===`);
    show("TRIGGER   ", e.trigger);
    show("READS     ", e.reads);
    show("WRITES    ", e.writes);
    show("DOWNSTREAM", e.downstream);
    console.log("");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
