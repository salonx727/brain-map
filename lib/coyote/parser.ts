// Pure function: raw COYOTE text -> { nodes, diagnostics }. No I/O — testable against
// fixture text alone, independent of where the text came from (resolver.ts's concern).
//
// Locates §03 / §35 / §15 / §00a by the same heading heuristic already proven in
// scripts/build_coyote_index.py (a heading line containing "§"), slices each section to
// its own subsection, then hands the slice to the matching extractor. Diagnostics from
// every stage are collected, never thrown — one missing section degrades only the nodes
// that depend on it; it doesn't abort the rest.

import type { AttributedItem, CanonicalConnection, CanonicalNode, Diagnostic, EngineNode, SourceMeta } from "@/lib/types/canonicalNode";
import type { CoyoteSource } from "@/lib/coyote/resolver";
import { extractScreens } from "@/lib/coyote/extractors/screens";
import { extractEngines } from "@/lib/coyote/extractors/engines";
import { extractIntake } from "@/lib/coyote/extractors/intake";
import { extractBlockers } from "@/lib/coyote/extractors/blockers";
import { extractOpenQuestions } from "@/lib/coyote/extractors/openQuestions";
import { extractConnections } from "@/lib/coyote/extractors/connections";

export interface ParseResult {
  nodes: CanonicalNode[];
  diagnostics: Diagnostic[];
  /** Full extracted set, including unattributed items — nothing is silently dropped. */
  blockers: AttributedItem[];
  openQuestions: AttributedItem[];
  /**
   * Data-flow edges between canonical nodes, extracted from each engine's already-parsed
   * §35 DOWNSTREAM field (see extractors/connections.ts) plus the one edge canon names as
   * an explicit exception (§35.8's backward edge). Deliberately narrow — see that file's
   * header comment for why a broader "scan every field's prose" approach was rejected as
   * unreliable (this workspace's own Aug 30 SPINE audit finding). A DOWNSTREAM target that
   * doesn't resolve, or resolves ambiguously, produces a diagnostic and no edge — it is
   * never guessed.
   */
  connections: CanonicalConnection[];
}

interface Heading {
  index: number;
  level: number;
  title: string;
}

function findHeadings(lines: string[]): Heading[] {
  const out: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const match = /^(#{1,6})\s+(.*§.*)$/.exec(trimmed);
    if (match) out.push({ index: i, level: match[1].length, title: match[2].trim() });
  }
  return out;
}

function sliceSection(lines: string[], headings: Heading[], sectionId: string): string[] | undefined {
  const idx = headings.findIndex((h) => new RegExp(`§${sectionId}\\b`).test(h.title));
  if (idx === -1) return undefined;
  const start = headings[idx];
  const next = headings.slice(idx + 1).find((h) => h.level <= start.level);
  const end = next ? next.index : lines.length;
  return lines.slice(start.index, end);
}

function attachItems(nodes: EngineNode[], items: AttributedItem[], field: "blockers" | "openQuestions"): void {
  const byKey = new Map(nodes.map((n) => [n.nodeKey, n]));
  for (const item of items) {
    if (item.confidence !== "matched" || !item.nodeKey) continue;
    const node = byKey.get(item.nodeKey);
    if (node) node[field].push(item);
  }
}

export function parseCanonicalNodes(source: CoyoteSource): ParseResult {
  const lines = source.text.split(/\r?\n/);
  const headings = findHeadings(lines);
  const diagnostics: Diagnostic[] = [];
  const sourceMeta: SourceMeta = { fileName: source.fileName, resolvedAt: source.modifiedAt };

  const section03 = sliceSection(lines, headings, "03");
  const section35 = sliceSection(lines, headings, "35");
  const section15 = sliceSection(lines, headings, "15");
  const section00a = sliceSection(lines, headings, "00a");

  const screens = extractScreens(section03, sourceMeta);
  const engines = extractEngines(section35, sourceMeta);
  const intake = extractIntake(lines, sourceMeta);
  const blockers = extractBlockers(section15);
  const openQuestions = extractOpenQuestions(section00a);

  attachItems(engines.nodes, blockers.items, "blockers");
  attachItems(engines.nodes, openQuestions.items, "openQuestions");

  const connections = extractConnections(engines.nodes);

  diagnostics.push(...screens.diagnostics, ...engines.diagnostics, ...intake.diagnostics, ...blockers.diagnostics, ...openQuestions.diagnostics, ...connections.diagnostics);

  return {
    nodes: [...screens.nodes, ...engines.nodes, ...intake.nodes],
    diagnostics,
    blockers: blockers.items,
    openQuestions: openQuestions.items,
    connections: connections.connections,
  };
}
