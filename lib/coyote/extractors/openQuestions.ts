// Extracts Q-ID rows from every markdown table in §00a (Active PLP Queue) and attributes
// each to an engine by the same best-effort name matching as blockers.ts.
//
// §00a is not one table — it's a running log of many separate `|ID|Status|Item|`-shaped
// tables interspersed with prose, and at least one carries a different column ORDER
// (`|ID|Question|Status|`). Column position is therefore never assumed — each table's
// own header row is read to resolve which column is which, per table.
//
// "Open questions" here means rows whose Status text contains OPEN or PARTIAL — fully
// CLOSED/RESOLVED/RETIRED/DEFERRED/HELD rows are parsed (so nothing is silently dropped)
// but excluded from the returned set. This is a stated modeling choice, not a canon rule.

import type { AttributedItem, Diagnostic } from "@/lib/types/canonicalNode";
import { matchRegistryEntries } from "@/lib/coyote/nodeRegistry";

const SECTION_LABEL = "§00a";
const TEXT_COLUMN_NAMES = ["item", "question", "resolution"];

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
  const idIdx = lower.indexOf("id");
  if (idIdx === -1) return undefined;
  const statusIdx = lower.indexOf("status");
  const textIdx = lower.findIndex((c) => TEXT_COLUMN_NAMES.includes(c));
  if (textIdx === -1) return undefined;
  return { id: idIdx, status: statusIdx === -1 ? undefined : statusIdx, text: textIdx };
}

function isOpenIsh(status: string | undefined): boolean {
  if (!status) return false;
  const upper = status.toUpperCase();
  return upper.includes("OPEN") || upper.includes("PARTIAL");
}

export function extractOpenQuestions(section00aLines: string[] | undefined): { items: AttributedItem[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (!section00aLines) {
    diagnostics.push({ severity: "error", message: "§00a not found in resolved COYOTE — open questions unreachable." });
    return { items: [], diagnostics };
  }

  const items: AttributedItem[] = [];
  let i = 0;
  while (i < section00aLines.length) {
    const line = section00aLines[i];
    if (!isTableRow(line)) {
      i++;
      continue;
    }
    const headerCells = splitRow(line);
    const nextLine = section00aLines[i + 1];
    const looksLikeHeader = nextLine && isTableRow(nextLine) && isSeparatorRow(splitRow(nextLine));
    const columns = looksLikeHeader ? resolveColumns(headerCells) : undefined;

    if (!columns) {
      i++;
      continue;
    }

    i += 2; // skip header + separator
    while (i < section00aLines.length && isTableRow(section00aLines[i])) {
      const cells = splitRow(section00aLines[i]);
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
          items.push({ text, qId, status, sourceSection: SECTION_LABEL, confidence: "matched", nodeKey: matches[0].nodeKey });
        } else {
          items.push({ text, qId, status, sourceSection: SECTION_LABEL, confidence: "unattributed" });
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

  const openOnly = items.filter((item) => isOpenIsh(item.status));
  return { items: openOnly, diagnostics };
}
