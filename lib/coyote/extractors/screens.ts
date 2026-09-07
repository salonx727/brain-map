// Extracts S0-S5 from the §03 "Screen Definitions" markdown table.
// MICROSITE shares that table but is deliberately not extracted this phase
// (reserved in nodeRegistry.ts, not required for S0-S5 — Codeman's Phase 2 scope).

import type { CanonRef, Diagnostic, FieldValue, ScreenNode, SourceMeta } from "@/lib/types/canonicalNode";
import { NODE_REGISTRY } from "@/lib/coyote/nodeRegistry";

const SCREEN_CODES = ["S0", "S1", "S2", "S3", "S4", "S5"] as const;

function isTableRow(line: string): boolean {
  return line.trim().startsWith("|");
}

function isSeparatorRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\||\|$/g, "");
  return trimmed.split("|");
}

/** Pulls the leading code off a first cell like "**S0 — The Marquee**" -> "S0". */
function leadingCode(rawFirstCell: string): string | null {
  const cleaned = rawFirstCell.replace(/\*\*/g, "").trim();
  const match = /^([A-Z][A-Z0-9]*)\b/.exec(cleaned);
  return match ? match[1] : null;
}

export function extractScreens(section03Lines: string[] | undefined, sourceMeta: SourceMeta): { nodes: ScreenNode[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const registryByCode = new Map(
    NODE_REGISTRY.filter((e) => e.kind === "screen" && e.implemented).map((e) => [e.aliases[0], e]),
  );

  if (!section03Lines) {
    for (const code of SCREEN_CODES) {
      const entry = registryByCode.get(code);
      if (!entry) continue;
      diagnostics.push({ severity: "error", nodeKey: entry.nodeKey, message: "§03 not found in resolved COYOTE — screen table unreachable." });
    }
    return { nodes: buildDisconnectedNodes(sourceMeta, "§03 not found"), diagnostics };
  }

  const rows = new Map<string, string>(); // code -> definition cell text
  for (const line of section03Lines) {
    if (!isTableRow(line) || isSeparatorRow(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 2) continue;
    const code = leadingCode(cells[0]);
    if (!code || !SCREEN_CODES.includes(code as (typeof SCREEN_CODES)[number])) continue;
    rows.set(code, cells[1].trim());
  }

  const nodes: ScreenNode[] = [];
  for (const code of SCREEN_CODES) {
    const entry = registryByCode.get(code);
    if (!entry) continue;
    const canonRefs: CanonRef[] = [{ type: "section", value: "§03" }];
    let definition: FieldValue;
    if (!rows.has(code)) {
      definition = { state: "disconnected", expectedAnchor: `§03 Screen Definitions row for ${code}` };
      diagnostics.push({ severity: "error", nodeKey: entry.nodeKey, message: `No §03 table row found for ${code}.` });
    } else {
      const value = rows.get(code) ?? "";
      definition = value.length > 0 ? { state: "present", value } : { state: "empty" };
    }
    nodes.push({
      nodeKey: entry.nodeKey,
      kind: "screen",
      label: entry.label,
      canonRefs,
      sourceMeta,
      definition,
    });
  }
  return { nodes, diagnostics };
}

function buildDisconnectedNodes(sourceMeta: SourceMeta, reason: string): ScreenNode[] {
  return SCREEN_CODES.map((code) => {
    const entry = NODE_REGISTRY.find((e) => e.kind === "screen" && e.aliases[0] === code);
    return {
      nodeKey: entry?.nodeKey ?? `screen:${code}`,
      kind: "screen" as const,
      label: entry?.label ?? code,
      canonRefs: [{ type: "section" as const, value: "§03" }],
      sourceMeta,
      definition: { state: "disconnected" as const, expectedAnchor: reason },
    };
  });
}
