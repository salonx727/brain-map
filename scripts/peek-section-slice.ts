// Read-only: every heading COYOTE offers for a given §, and which one the parser's
// first-match slice actually lands on. sliceSection takes the first heading whose title
// matches, so a table of contents that repeats the § earlier in the file silently wins.
//
//   npx tsx --env-file=.env scripts/peek-section-slice.ts 00a

import { readFile } from "node:fs/promises";
import { resolveCoyoteSource } from "../lib/coyote/resolver";

async function main() {
  const sectionId = process.argv[2] ?? "00a";
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const lines = (await readFile(resolved.source.filePath, "utf8")).split(/\r?\n/);

  const headings: { index: number; level: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*§.*)$/.exec(lines[i].trim());
    if (m) headings.push({ index: i, level: m[1].length, title: m[2].trim() });
  }

  const re = new RegExp(`§${sectionId}\\b`);
  const matches = headings.filter((h) => re.test(h.title));
  console.log(`coyote: ${resolved.source.fileName}`);
  console.log(`headings matching §${sectionId}: ${matches.length}\n`);
  for (const h of matches) {
    const idx = headings.indexOf(h);
    const next = headings.slice(idx + 1).find((n) => n.level <= h.level);
    const end = next ? next.index : lines.length;
    const rows = lines.slice(h.index, end).filter((l) => l.trim().startsWith("|")).length;
    const mark = h === matches[0] ? "  <- parser slices THIS one" : "";
    console.log(`  line ${String(h.index + 1).padStart(6)}  h${h.level}  ${h.title.slice(0, 54).padEnd(56)} ${String(end - h.index).padStart(6)} lines, ${String(rows).padStart(4)} table rows${mark}`);
  }
}

main();
