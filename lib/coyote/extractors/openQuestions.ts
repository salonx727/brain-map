// Extracts Q-ID rows from the registers of open questions COYOTE keeps — §00a (Active PLP
// Queue) and §39.7 — and attributes each to an engine by the same best-effort name
// matching as blockers.ts.
//
// Neither section is one table. §00a is a running log of many separate `|ID|Status|Item|`
// tables interspersed with prose; they do not agree on column ORDER (`|ID|Question|Status|`
// appears too) or even on how to spell their own columns (§39.7 heads its id column
// `Q-ID`). Column position is therefore never assumed — each table's own header row is
// read to resolve which column is which, per table.
//
// Every row is returned. CLOSED / RESOLVED / RETIRED stay in the set because the map now
// shows every COYOTE line as BLK (Shawn, 2026-09-13) — dropping them made 74 leftover
// to-dos look like they had no canon source, when the Q-ID was sitting in §00a the whole
// time. Status still travels on the item so the card can mark a closed line done.
//
// One run of 53 rows in §00a carries no header at all — it simply starts, having
// inherited the shape of the table above it across an edit. Requiring a header cost those
// 53 their place on the map, and cost it silently, which is why every run this file
// declines to read now leaves a diagnostic behind. A headerless run is read only when the
// rows themselves say what they are; nothing else is inferred.

import type { AttributedItem, Diagnostic } from "@/lib/types/canonicalNode";
import { matchRegistryEntries } from "@/lib/coyote/nodeRegistry";

const TEXT_COLUMN_NAMES = ["item", "question", "resolution"];

/**
 * `ID`, but §39.7 heads the same column `Q-ID` — and that one header word cost that
 * table's twelve questions their place on the map entirely, silently, because a table
 * whose columns don't resolve was skipped rather than reported. Matched as a set of
 * accepted spellings rather than a substring test, so a future `GRID` or `VALID` column
 * cannot quietly become the id.
 */
const ID_COLUMN_NAMES = ["id", "q-id", "qid", "q id", "ref"];

/** A register id as these sections write them. Anchored — `Q-` has to be the whole cell, not a mention inside prose. */
const REGISTER_ID = /^Q-[A-Z0-9][A-Z0-9-]*$/;

/** OPEN, DEFERRED, `OPEN · NARROWED` — short and shouted. Long prose in this column means it is the item, not a status. */
const STATUS_CELL = /^[A-Z][A-Z0-9 \u00b7/-]*$/;

/**
 * The share of first cells that must be register ids before a headerless run is read as
 * the register continued. Not all of them: §00a's own run closes with two rows keyed
 * `WATCH/NEEDS-SOURCE` and `TRILOGY + LADDER` — labels rather than ids, but rows of that
 * same table all the same, and demanding a clean sweep threw away the other 51 with them.
 */
const ID_SHARE = 0.8;

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|");
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|").map((c) => c.trim());
}

interface ColumnMap {
  id: number;
  status?: number;
  text: number;
}

function resolveColumns(headerCells: string[]): ColumnMap | undefined {
  const lower = headerCells.map((c) => c.toLowerCase());
  const idIdx = lower.findIndex((c) => ID_COLUMN_NAMES.includes(c));
  if (idIdx === -1) return undefined;
  const statusIdx = lower.indexOf("status");
  const textIdx = lower.findIndex((c) => TEXT_COLUMN_NAMES.includes(c));
  if (textIdx === -1) return undefined;
  return { id: idIdx, status: statusIdx === -1 ? undefined : statusIdx, text: textIdx };
}

/** How far a run of consecutive table rows extends from `start`. */
function runEnd(lines: string[], start: number): number {
  let i = start;
  while (i < lines.length && isTableRow(lines[i])) i++;
  return i;
}

/**
 * Columns for a run of rows that never declared any, read off the rows themselves.
 *
 * Three things have to agree before this answers at all: one consistent cell count, a
 * clear majority of first cells holding a register id, and — where there is a third
 * column — a second column that reads as a status on every row rather than as prose.
 * Anything less returns undefined and the caller reports the run instead of reading it.
 */
function inferColumns(lines: string[], start: number, end: number): ColumnMap | undefined {
  const rows = lines.slice(start, end).map(splitRow).filter((cells) => !isSeparatorRow(cells));
  if (rows.length < 3) return undefined;
  const width = rows[0].length;
  if (width < 2 || rows.some((cells) => cells.length !== width)) return undefined;
  if (rows.filter((cells) => REGISTER_ID.test(cells[0])).length < rows.length * ID_SHARE) return undefined;

  if (width === 2) return { id: 0, text: 1 };
  const statusLike = rows.every((cells) => cells[1].length <= 40 && STATUS_CELL.test(cells[1]));
  return statusLike ? { id: 0, status: 1, text: 2 } : undefined;
}

export function extractOpenQuestions(
  sectionLines: string[] | undefined,
  sectionLabel = "\u00a700a",
): { items: AttributedItem[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (!sectionLines) {
    diagnostics.push({ severity: "error", message: `${sectionLabel} not found in resolved COYOTE — open questions unreachable.` });
    return { items: [], diagnostics };
  }

  const items: AttributedItem[] = [];
  let i = 0;
  while (i < sectionLines.length) {
    const line = sectionLines[i];
    if (!isTableRow(line)) {
      i++;
      continue;
    }
    const headerCells = splitRow(line);
    const nextLine = sectionLines[i + 1];
    const looksLikeHeader = nextLine && isTableRow(nextLine) && isSeparatorRow(splitRow(nextLine));
    const declared = looksLikeHeader ? resolveColumns(headerCells) : undefined;

    const end = runEnd(sectionLines, i);
    // A declared header costs two lines of the run; an inferred one costs none of it.
    const columns = declared ?? inferColumns(sectionLines, i, end);
    if (!columns) {
      diagnostics.push({
        severity: "warning",
        message: `${sectionLabel} table at row "${headerCells[0] ?? ""}" was not read — its columns could not be resolved and nothing about them was assumed. ${end - i} row(s) are not on the map.`,
      });
      i = end;
      continue;
    }

    if (declared) i += 2; // skip header + separator
    while (i < sectionLines.length && isTableRow(sectionLines[i])) {
      const cells = splitRow(sectionLines[i]);
      if (isSeparatorRow(cells)) {
        i++;
        continue;
      }
      const qId = cells[columns.id]?.trim();
      const status = columns.status !== undefined ? cells[columns.status]?.trim() : undefined;
      const text = cells[columns.text]?.trim();

      if (text && text.length > 0) {
        const matches = matchRegistryEntries(text);
        if (matches.length === 1) {
          items.push({ text, qId, status, sourceSection: sectionLabel, confidence: "matched", nodeKey: matches[0].nodeKey });
        } else {
          items.push({ text, qId, status, sourceSection: sectionLabel, confidence: "unattributed" });
          if (matches.length > 1) {
            diagnostics.push({
              severity: "warning",
              message: `Ambiguous open-question attribution — ${qId ?? "(no id)"} matches ${matches.map((m) => m.nodeKey).join(", ")}. Left unattributed rather than guessed.`,
            });
          }
        }
      }
      i++;
    }
  }

  return { items, diagnostics };
}
