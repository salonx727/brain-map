// Read-only: does every item the map shows carry a stable identifier in COYOTE, or
// only its own text?
//
// This is the question an overlay table has to answer before it can exist. An overlay
// row keyed on anything that moves when Shawn edits a line will orphan itself on the
// next re-parse, silently, and the state it was holding is gone.
//
// Reports per source section: how many items carry a register ID, what shape that ID
// has, whether the IDs are unique, and — for the ones with no ID — what the parser
// would otherwise have to key on.
//
//   npx tsx --env-file=.env scripts/audit-item-identity.ts
//   npx tsx --env-file=.env scripts/audit-item-identity.ts --dump-15   # raw §15 bullets

import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";
import type { AttributedItem, UnattributedItem } from "../lib/types/canonicalNode";

type Item = AttributedItem | UnattributedItem;

/** The shapes canon actually uses for a register id, most specific first. */
const ID_SHAPES: { name: string; re: RegExp }[] = [
  { name: "Q-ID (Q-FOO-BAR)", re: /^Q-[A-Z0-9][A-Z0-9-]*$/ },
  { name: "LOCK id", re: /^LOCK-\d{6}-\d+$/ },
  { name: "numeric", re: /^\d+$/ },
];

function idShape(id: string | undefined): string {
  if (!id) return "none";
  return ID_SHAPES.find((s) => s.re.test(id))?.name ?? `other (${id})`;
}

/** Anything in the text that could serve as a stable key if the row itself has no id. */
function inlineMarkers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bLOCK-\d{6}-\d+/g)) out.add(m[0]);
  for (const m of text.matchAll(/\bQ-[A-Z][A-Z0-9-]{2,}/g)) out.add(m[0]);
  for (const m of text.matchAll(/\b[SE]\d{2}\b/g)) out.add(m[0]);
  return [...out];
}

async function main() {
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const parsed = parseCanonicalNodes(resolved.source);

  if (process.argv.includes("--dump-15")) {
    const lines = resolved.source.text.split(/\r?\n/);
    const start = lines.findIndex((l) => /^#{1,6}\s+.*§15\b/.test(l.trim()));
    const end = lines.findIndex((l, i) => i > start && /^#{1,2}\s+.*§/.test(l.trim()));
    console.log(lines.slice(start, end === -1 ? start + 90 : end).join("\n"));
    return;
  }

  const groups = new Map<string, Item[]>();
  const add = (i: Item) => {
    // "§15 › Launch Blockers" and "§00a" — group by the section, not the subheading.
    const key = i.sourceSection.split(" › ")[0];
    groups.set(key, [...(groups.get(key) ?? []), i]);
  };
  parsed.blockers.forEach(add);
  parsed.openQuestions.forEach(add);

  console.log(`SOURCE  ${resolved.source.fileName}\n`);

  for (const [section, items] of [...groups.entries()].sort()) {
    const withId = items.filter((i) => i.qId);
    const ids = withId.map((i) => i.qId as string);
    const dupes = ids.filter((id, n) => ids.indexOf(id) !== n);
    const shapes = new Map<string, number>();
    for (const i of items) {
      const s = idShape(i.qId);
      shapes.set(s, (shapes.get(s) ?? 0) + 1);
    }

    console.log(`${section}`);
    console.log(`  items                ${items.length}`);
    console.log(`  carry a register id  ${withId.length}  (${Math.round((withId.length / items.length) * 100)}%)`);
    console.log(`  id shapes            ${[...shapes].map(([s, n]) => `${s}=${n}`).join("  ")}`);
    console.log(`  duplicate ids        ${dupes.length}${dupes.length ? ` :: ${[...new Set(dupes)].join(", ")}` : ""}`);

    const without = items.filter((i) => !i.qId);
    if (without.length > 0) {
      const withMarker = without.filter((i) => inlineMarkers(i.text).length > 0);
      console.log(`  no id at all         ${without.length}`);
      console.log(`    of those, text mentions a LOCK/Q/engine code: ${withMarker.length}`);
      console.log(`    parser must key on: sourceSection + text`);
      console.log(`    sample:`);
      for (const i of without.slice(0, 4)) {
        console.log(`      "${i.text.slice(0, 88)}${i.text.length > 88 ? "…" : ""}"`);
        const m = inlineMarkers(i.text);
        if (m.length) console.log(`         inline markers: ${m.join(", ")}`);
      }
    }
    console.log("");
  }

  // The thing an overlay would actually be keyed on today.
  const all = [...parsed.blockers, ...parsed.openQuestions];
  const stable = all.filter((i) => i.qId).length;
  console.log(`VERDICT`);
  console.log(`  ${stable} of ${all.length} items have an id canon itself wrote.`);
  console.log(`  ${all.length - stable} are identifiable only by their section and their text.`);
}

main();
