// Extracts E01-E11 TRIGGER/READS/WRITES/DOWNSTREAM from §35 subsections.
// The four fields are NOT uniformly present across engines in canon today (confirmed by
// reading the source directly, e.g. E08 SKINZ has no TRIGGER/READS/WRITES label at all,
// several engines have no DOWNSTREAM label) — that irregularity is the point of the
// present/empty/disconnected/unknown model, not a parsing bug to paper over.

import type { CanonRef, Diagnostic, EngineNode, FieldValue, SourceMeta } from "@/lib/types/canonicalNode";
import { NODE_REGISTRY } from "@/lib/coyote/nodeRegistry";

const FIELD_LABELS = ["TRIGGER", "READS", "WRITES", "DOWNSTREAM", "EMITS AT SESSION CLOSE"] as const;
type FieldLabel = (typeof FIELD_LABELS)[number];

/**
 * The one field label canon writes with a trailing citation inside the same bold span, so
 * it is matched as a prefix. The other four stay exact-match on purpose — prefix matching
 * them would let "WRITES, RESTATED" register as a WRITES field, which is precisely the
 * failure the exact-match rule below exists to prevent.
 */
const PREFIX_MATCHED_FIELD_LABELS: readonly FieldLabel[] = ["EMITS AT SESSION CLOSE"];

// Other bold, structured section labels confirmed present in §35 alongside the four core
// fields (read directly from the source, not guessed). Recognizing these as *boundaries*
// only — never as fields themselves — stops a field's captured value from sweeping in
// unrelated trailing content it shares a subsection with. Matched as a prefix because
// canon sometimes appends a citation inside the same bold span, e.g.
// "**COMPENSATION MODEL (LOCK-260816-170 through 179)**".
const EXTRA_TERMINATOR_LABELS = ["CONTROL TARGETS", "RECEIVES", "COMPENSATION MODEL"] as const;

interface SubHeading {
  index: number;
  title: string;
}

function findSubHeadings(lines: string[]): SubHeading[] {
  const out: SubHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^#{3}\s+.*§35\./.test(trimmed)) {
      out.push({ index: i, title: trimmed.replace(/^#{3}\s+/, "") });
    }
  }
  return out;
}

function sliceForEngine(lines: string[], headings: SubHeading[], code: string): string[] | undefined {
  const boundary = new RegExp(`\\b${code}\\b`);
  const idx = headings.findIndex((h) => boundary.test(h.title));
  if (idx === -1) return undefined;
  const end = idx + 1 < headings.length ? headings[idx + 1].index : lines.length;
  return lines.slice(headings[idx].index, end);
}

interface Boundary {
  /** Index of the opening "**" — where a preceding field's captured value must stop. */
  matchStart: number;
  /** Index right after the closing "**" — where this field's own value (if a field) starts. */
  afterMatch: number;
  kind: "field" | "terminator";
  label?: FieldLabel;
}

/**
 * Finds every relevant bold span in document order: the four core field labels (exact
 * match only — never fuzzy, so a field is never invented from a look-alike phrase like
 * "WRITES, RESTATED") plus the known extra structured labels, recognized as boundaries
 * only, never captured as a field value.
 */
function findBoundaries(text: string): Boundary[] {
  const boundaries: Boundary[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim();
    const matchStart = m.index;
    const afterMatch = m.index + m[0].length;

    const exact = (FIELD_LABELS as readonly string[]).includes(inner) ? (inner as FieldLabel) : undefined;
    const prefixed = exact
      ? undefined
      : PREFIX_MATCHED_FIELD_LABELS.find((label) => inner.startsWith(label) && !/^[A-Za-z]/.test(inner.slice(label.length)));
    const fieldLabel = exact ?? prefixed;
    if (fieldLabel) {
      boundaries.push({ matchStart, afterMatch, kind: "field", label: fieldLabel });
      continue;
    }
    const isTerminator = EXTRA_TERMINATOR_LABELS.some(
      (label) => inner === label || (inner.startsWith(label) && !/^[A-Za-z]/.test(inner.slice(label.length))),
    );
    if (isTerminator) {
      boundaries.push({ matchStart, afterMatch, kind: "terminator" });
    }
  }
  return boundaries;
}

function extractFields(sliceLines: string[], nodeKey: string, diagnostics: Diagnostic[]): Record<FieldLabel, FieldValue> {
  const text = sliceLines.join("\n");
  const boundaries = findBoundaries(text);
  const fieldHits = boundaries.filter((b) => b.kind === "field");

  const result: Partial<Record<FieldLabel, FieldValue>> = {};
  const seen = new Set<FieldLabel>();

  for (const hit of fieldHits) {
    const label = hit.label as FieldLabel;
    const next = boundaries.find((b) => b.matchStart > hit.matchStart);
    const rawValue = text.slice(hit.afterMatch, next ? next.matchStart : text.length).trim();

    if (seen.has(label)) {
      result[label] = { state: "unknown", reason: `"${label}" appears more than once in this engine's section — cannot determine which is authoritative.` };
      diagnostics.push({ severity: "warning", nodeKey, message: `Duplicate **${label}** label found for ${nodeKey}.` });
      continue;
    }
    seen.add(label);

    if (rawValue.length === 0) {
      result[label] = { state: "empty" };
    } else {
      result[label] = { state: "present", value: rawValue };
      if (!next) {
        diagnostics.push({
          severity: "warning",
          nodeKey,
          message: `"${label}" for ${nodeKey} runs to the end of its section without any terminating label (core or structured) — captured value may include unrelated trailing content.`,
        });
      }
    }
  }

  for (const label of FIELD_LABELS) {
    if (!(label in result)) {
      result[label] = { state: "disconnected", expectedAnchor: `**${label}** in the ${nodeKey} §35 subsection` };
    }
  }

  return result as Record<FieldLabel, FieldValue>;
}

export function extractEngines(section35Lines: string[] | undefined, sourceMeta: SourceMeta): { nodes: EngineNode[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const engineEntries = NODE_REGISTRY.filter((e) => e.kind === "engine" && e.implemented);

  if (!section35Lines) {
    for (const entry of engineEntries) {
      diagnostics.push({ severity: "error", nodeKey: entry.nodeKey, message: "§35 not found in resolved COYOTE — engine contracts unreachable." });
    }
    return {
      nodes: engineEntries.map((entry) => buildDisconnectedEngine(entry.nodeKey, entry.label, sourceMeta, "§35 not found")),
      diagnostics,
    };
  }

  const subHeadings = findSubHeadings(section35Lines);
  const nodes: EngineNode[] = [];

  for (const entry of engineEntries) {
    const code = entry.aliases[0]; // "E01".."E11"
    const slice = sliceForEngine(section35Lines, subHeadings, code);
    const canonRefs: CanonRef[] = [{ type: "section", value: "§35" }];

    if (!slice) {
      diagnostics.push({ severity: "error", nodeKey: entry.nodeKey, message: `No §35 subsection heading found for ${code}.` });
      nodes.push(buildDisconnectedEngine(entry.nodeKey, entry.label, sourceMeta, `§35 subsection for ${code}`));
      continue;
    }

    const fields = extractFields(slice, entry.nodeKey, diagnostics);
    nodes.push({
      nodeKey: entry.nodeKey,
      kind: "engine",
      label: entry.label,
      canonRefs,
      sourceMeta,
      trigger: fields.TRIGGER,
      reads: fields.READS,
      writes: fields.WRITES,
      downstream: fields.DOWNSTREAM,
      emits: fields["EMITS AT SESSION CLOSE"],
      blockers: [],
      openQuestions: [],
    });
  }

  return { nodes, diagnostics };
}

function buildDisconnectedEngine(nodeKey: string, label: string, sourceMeta: SourceMeta, reason: string): EngineNode {
  const disconnected: FieldValue = { state: "disconnected", expectedAnchor: reason };
  return {
    nodeKey,
    kind: "engine",
    label,
    canonRefs: [{ type: "section", value: "§35" }],
    sourceMeta,
    trigger: disconnected,
    reads: disconnected,
    writes: disconnected,
    downstream: disconnected,
    emits: disconnected,
    blockers: [],
    openQuestions: [],
  };
}
