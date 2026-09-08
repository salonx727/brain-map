// What the blocker/question matcher fails to place, and whether an engine is named in the
// text anyway. Answers one question before any routing rule is invented: are these items
// engine work the matcher missed, or work that genuinely belongs to nobody on the map?
//
//   npx tsx --env-file=.env scripts/dump-unattributed.ts

import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";
import type { EngineNode, AttributedItem } from "../lib/types/canonicalNode";

async function main() {
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const parsed = parseCanonicalNodes(resolved.source);
  const engines = parsed.nodes.filter((n): n is EngineNode => n.kind === "engine");

  // Every handle an engine answers to: its label, its E-number, its §35.x anchor.
  const handles = engines.map((e) => ({
    key: e.nodeKey,
    label: e.label,
    num: e.nodeKey.replace("engine:", ""),
    sections: e.canonRefs.filter((r) => r.type === "section").map((r) => r.value),
  }));

  function namedEngines(text: string): string[] {
    const hit = new Set<string>();
    const upper = text.toUpperCase();
    for (const h of handles) {
      if (upper.includes(h.label.toUpperCase())) hit.add(`${h.num}(name)`);
      else if (new RegExp(`\\b${h.num}\\b`).test(text)) hit.add(`${h.num}(num)`);
      else if (h.sections.some((s) => text.includes(s))) hit.add(`${h.num}(§)`);
    }
    return [...hit];
  }

  function report(title: string, items: AttributedItem[]) {
    const loose = items.filter((i) => i.confidence === "unattributed");
    let reachable = 0;
    console.log(`\n===== ${title} — ${loose.length} unattributed =====`);
    for (const i of loose) {
      const named = namedEngines(i.text);
      if (named.length) reachable++;
      console.log(`  [${named.join(",") || "—"}] ${i.text.replace(/\s+/g, " ").slice(0, 100)}`);
    }
    console.log(`  → ${reachable} of ${loose.length} name an engine somewhere in their text`);
  }

  report("BLOCKERS §15", parsed.blockers);
  report("OPEN QUESTIONS §00a", parsed.openQuestions);
}

main();
