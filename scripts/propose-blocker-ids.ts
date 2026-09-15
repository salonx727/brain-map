// Proposes a stable id for every §15 blocker and writes the amendment Shawn would paste
// into COYOTE. Writes nothing into COYOTE itself — that is his to do, and this script has
// no path to the file open for writing.
//
// WHY THE ID HAS NO SECTION NUMBER IN IT
// The obvious form is BLK-15-001. This uses BLK-001 instead, because nodeRegistry.ts
// already settled this question for nodes and the same reasoning applies here: section
// numbers are metadata, never identity, so a COYOTE resequencing fold cannot orphan the
// overlay rows keyed on them. §15 has already moved once. Putting "15" inside the id
// means every overlay row dies the next time it moves. The section is still carried, as
// a field, where it can change without breaking the join.
//
// WHY ALLOCATION IS PERSISTED
// An id is only stable if it is assigned once and never reassigned. Re-running this after
// Shawn adds, deletes, or rewords a blocker must leave every existing id exactly where it
// was — so the allocation lives in a file, matched on normalized text, and new ids are
// only ever appended. A deleted blocker's id is retired, never reused.
//
//   npx tsx --env-file=.env scripts/propose-blocker-ids.ts           # dry run, prints the patch
//   npx tsx --env-file=.env scripts/propose-blocker-ids.ts --write   # also saves the allocation

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveCoyoteSource } from "../lib/coyote/resolver";

const ALLOCATION_PATH = resolve(process.cwd(), "outputs/blocker-id-allocation.json");
const PATCH_PATH = resolve(process.cwd(), "outputs/section-15-amendment.md");

interface Allocation {
  /** Bumped only if the id format itself ever changes — never on content edits. */
  scheme: "BLK-NNN";
  note: string;
  assigned: { id: string; text: string; firstSeen: string; subheading: string }[];
  retired: { id: string; text: string; retiredAt: string }[];
}

/**
 * Matching key for "is this the same blocker I already numbered?". Deliberately loose on
 * whitespace and canon's strikethrough/emphasis marks, strict on words — a blocker that
 * gets reworded is a new blocker for numbering purposes, and the drift view is where that
 * shows up rather than being silently re-keyed here.
 */
function matchKey(text: string): string {
  return text
    .replace(/[*~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function nextId(n: number): string {
  return `BLK-${String(n).padStart(3, "0")}`;
}

async function loadAllocation(): Promise<Allocation> {
  try {
    return JSON.parse(await readFile(ALLOCATION_PATH, "utf8")) as Allocation;
  } catch {
    return {
      scheme: "BLK-NNN",
      note: "Assigned once, never reassigned. Ids are not reused after retirement. Section and subheading are fields, not identity.",
      assigned: [],
      retired: [],
    };
  }
}

interface Bullet {
  text: string;
  subheading: string;
  lineIndex: number;
}

/** Reads §15's bullets in document order, carrying the ### subheading each sits under. */
function readSection15(lines: string[]): { bullets: Bullet[]; start: number; end: number } {
  const start = lines.findIndex((l) => /^#{1,6}\s+.*§15\s*—/.test(l.trim()));
  if (start === -1) throw new Error("§15 heading not found.");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s+.*§/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }

  const bullets: Bullet[] = [];
  let subheading = "§15";
  for (let i = start; i < end; i++) {
    const line = lines[i].trim();
    const h = /^#{3}\s+(.*)$/.exec(line);
    if (h) {
      subheading = h[1].trim();
      continue;
    }
    const b = /^[-*]\s+(.*)$/.exec(line);
    if (b && b[1].trim().length > 0) bullets.push({ text: b[1].trim(), subheading, lineIndex: i });
  }
  return { bullets, start, end };
}

async function main() {
  const write = process.argv.includes("--write");
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const lines = resolved.source.text.split(/\r?\n/);
  const { bullets, start, end } = readSection15(lines);

  const allocation = await loadAllocation();
  const byKey = new Map(allocation.assigned.map((a) => [matchKey(a.text), a]));
  const used = new Set([...allocation.assigned, ...allocation.retired].map((a) => a.id));
  let counter = 0;
  const now = new Date().toISOString().slice(0, 10);

  let fresh = 0;
  const numbered = bullets.map((b) => {
    const existing = byKey.get(matchKey(b.text));
    if (existing) return { ...b, id: existing.id, isNew: false };
    do {
      counter++;
    } while (used.has(nextId(counter)));
    used.add(nextId(counter));
    fresh++;
    return { ...b, id: nextId(counter), isNew: true };
  });

  // Anything previously numbered that is no longer in §15 is retired, not recycled.
  const presentKeys = new Set(bullets.map((b) => matchKey(b.text)));
  const newlyRetired = allocation.assigned.filter((a) => !presentKeys.has(matchKey(a.text)));

  // Rebuild §15 with the id leading each bullet, preserving order, subheadings, and the
  // classification table verbatim.
  const out: string[] = [];
  const idByLine = new Map(numbered.map((n) => [n.lineIndex, n.id]));
  for (let i = start; i < end; i++) {
    const id = idByLine.get(i);
    if (id === undefined) {
      out.push(lines[i]);
      continue;
    }
    const b = /^(\s*)[-*]\s+(.*)$/.exec(lines[i]);
    out.push(`${b?.[1] ?? ""}- **${id}** · ${b?.[2].trim() ?? ""}`);
  }

  const patch = [
    `<!--`,
    `  PROPOSED AMENDMENT TO §15 — generated ${now} from ${resolved.source.fileName}`,
    `  ${numbered.length} blockers, each given a stable id. Text, order, subheadings and the`,
    `  classification table are unchanged — only the "**BLK-NNN** · " prefix is added.`,
    ``,
    `  Ids are permanent once ruled. They carry no section number on purpose, so a future`,
    `  resequencing fold cannot orphan the state attached to them.`,
    ``,
    `  Replace §15 in COYOTE with everything below this comment block.`,
    `-->`,
    ``,
    ...out,
  ].join("\n");

  console.log(patch);
  console.log(`\n${"-".repeat(70)}`);
  console.log(`blockers found      ${bullets.length}`);
  console.log(`ids carried over    ${numbered.length - fresh}`);
  console.log(`ids newly assigned  ${fresh}`);
  console.log(`retired this run    ${newlyRetired.length}${newlyRetired.length ? ` :: ${newlyRetired.map((r) => r.id).join(", ")}` : ""}`);
  console.log(`subheadings         ${[...new Set(bullets.map((b) => b.subheading))].length}`);

  if (!write) {
    console.log(`\nDry run. Nothing saved. Re-run with --write to persist the allocation and the patch file.`);
    return;
  }

  const updated: Allocation = {
    ...allocation,
    assigned: numbered.map((n) => ({
      id: n.id,
      text: n.text,
      subheading: n.subheading,
      firstSeen: byKey.get(matchKey(n.text))?.firstSeen ?? now,
    })),
    retired: [...allocation.retired, ...newlyRetired.map((r) => ({ id: r.id, text: r.text, retiredAt: now }))],
  };

  await mkdir(resolve(process.cwd(), "outputs"), { recursive: true });
  await writeFile(ALLOCATION_PATH, JSON.stringify(updated, null, 2) + "\n", "utf8");
  await writeFile(PATCH_PATH, patch + "\n", "utf8");
  console.log(`\nallocation  ${ALLOCATION_PATH}`);
  console.log(`patch       ${PATCH_PATH}`);
}

main();
