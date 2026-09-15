// Read-only: every table inside §00a and whether the extractor can read it. A table whose
// columns don't resolve is skipped in silence, so this is the only way to see one.
//
//   npx tsx --env-file=.env scripts/peek-00a-tables.ts

import { readFile } from "node:fs/promises";
import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { extractOpenQuestions } from "../lib/coyote/extractors/openQuestions";

function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}
const isRow = (l: string) => l.trim().startsWith("|");
const isSep = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));

async function main() {
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const lines = (await readFile(resolved.source.filePath, "utf8")).split(/\r?\n/);

  const headings: { index: number; level: number; title: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*§.*)$/.exec(lines[i].trim());
    if (m) headings.push({ index: i, level: m[1].length, title: m[2].trim() });
  }
  const start = headings.find((h) => /§00a\b/.test(h.title))!;
  const si = headings.indexOf(start);
  const next = headings.slice(si + 1).find((h) => h.level <= start.level);
  const section = lines.slice(start.index, next ? next.index : lines.length);

  console.log(`coyote: ${resolved.source.fileName}`);
  console.log(`§00a slice: ${section.length} lines\n`);

  let i = 0;
  let readable = 0;
  let skippedRows = 0;
  while (i < section.length) {
    if (!isRow(section[i])) {
      i++;
      continue;
    }
    const header = splitRow(section[i]);
    const hasSep = section[i + 1] && isRow(section[i + 1]) && isSep(splitRow(section[i + 1]));
    let j = i + (hasSep ? 2 : 1);
    let rows = 0;
    while (j < section.length && isRow(section[j])) {
      if (!isSep(splitRow(section[j]))) rows++;
      j++;
    }

    const lower = header.map((c) => c.toLowerCase());
    const hasId = lower.some((c) => ["id", "q-id", "qid", "q id", "ref"].includes(c));
    const hasText = lower.some((c) => ["item", "question", "resolution"].includes(c));
    const ok = hasSep && hasId && hasText;
    if (ok) readable += rows;
    else skippedRows += hasSep ? rows : rows + 1;

    const why = !hasSep ? "no separator row" : !hasId ? "no id column" : !hasText ? "no item/question column" : "";
    console.log(
      `${ok ? "  ok  " : "SKIP  "}line ${String(start.index + i + 1).padStart(6)}  ${String(rows).padStart(3)} rows  [${header.join("|").slice(0, 56)}]${why ? "  <- " + why : ""}`,
    );
    i = j;
  }

  const extracted = extractOpenQuestions(section).items.length;
  console.log(`\nrows in readable tables ${readable}`);
  console.log(`rows the extractor skips ${skippedRows}`);
  console.log(`questions actually extracted ${extracted}`);
}

main();
