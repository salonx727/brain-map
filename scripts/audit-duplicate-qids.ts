// Read-only: for every Q-ID that canon uses more than once, show each occurrence.
//
// A repeated id is either the same row delivered twice (dedupe and move on) or two
// different questions wearing one name (the id is not a key, and an overlay row keyed
// on it would attach state to the wrong question). Only the text can tell them apart,
// so print it.

import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";

async function main() {
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const parsed = parseCanonicalNodes(resolved.source);

  const byId = new Map<string, { text: string; section: string; status?: string }[]>();
  for (const q of parsed.openQuestions) {
    if (!q.qId) continue;
    byId.set(q.qId, [...(byId.get(q.qId) ?? []), { text: q.text, section: q.sourceSection, status: q.status }]);
  }

  const dupes = [...byId.entries()].filter(([, v]) => v.length > 1).sort();
  let identical = 0;
  let divergent = 0;

  for (const [id, rows] of dupes) {
    const texts = new Set(rows.map((r) => r.text.trim()));
    const same = texts.size === 1;
    if (same) identical++;
    else divergent++;
    console.log(`${id}  ×${rows.length}  ${same ? "IDENTICAL TEXT" : "DIFFERENT TEXT"}`);
    for (const r of rows) {
      console.log(`   [${r.section}${r.status ? ` · ${r.status}` : ""}] ${r.text.slice(0, 110)}${r.text.length > 110 ? "…" : ""}`);
    }
    console.log("");
  }

  console.log(`SUMMARY`);
  console.log(`  repeated ids            ${dupes.length}`);
  console.log(`  same text (a dupe row)  ${identical}`);
  console.log(`  different text          ${divergent}   <- id alone cannot key these`);

  const crossSection = dupes.filter(([, rows]) => new Set(rows.map((r) => r.section)).size > 1);
  console.log(`  spanning two sections   ${crossSection.length}${crossSection.length ? ` :: ${crossSection.map(([id]) => id).join(", ")}` : ""}`);
}

main();
