// Extracts INT GATE (§40) and INT BOOKING (§39) as minimal intake nodes. Neither has a §03
// table row or a §35 spine contract, so there is no structured field to capture yet — this
// extractor only confirms each section's heading still exists in the resolved COYOTE and
// carries it as the node's `definition`, exactly the way a missing §03 row produces
// `disconnected` in extractScreens.ts. A future pass can extract richer per-node content
// once something downstream actually needs it; nothing does yet.

import type { CanonRef, Diagnostic, FieldValue, IntakeNode, SourceMeta } from "@/lib/types/canonicalNode";
import { NODE_REGISTRY } from "@/lib/coyote/nodeRegistry";

const INTAKE_SECTIONS: Record<string, string> = {
  "intake:GATE": "40",
  "intake:BOOKING": "39",
};

interface TopHeading {
  index: number;
  title: string;
}

function findTopHeadings(lines: string[]): TopHeading[] {
  const out: TopHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^#{1,6}\s+.*§.*$/.test(trimmed)) {
      out.push({ index: i, title: trimmed.replace(/^#{1,6}\s+/, "").trim() });
    }
  }
  return out;
}

export function extractIntake(allLines: string[], sourceMeta: SourceMeta): { nodes: IntakeNode[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const entries = NODE_REGISTRY.filter((e) => e.kind === "intake" && e.implemented);
  const headings = findTopHeadings(allLines);
  const nodes: IntakeNode[] = [];

  for (const entry of entries) {
    const sectionId = INTAKE_SECTIONS[entry.nodeKey];
    const heading = sectionId ? headings.find((h) => new RegExp(`§${sectionId}\\b`).test(h.title)) : undefined;
    const canonRefs: CanonRef[] = sectionId ? [{ type: "section", value: `§${sectionId}` }] : [];

    let definition: FieldValue;
    if (!heading) {
      definition = { state: "disconnected", expectedAnchor: `§${sectionId ?? "?"} heading for ${entry.label}` };
      diagnostics.push({
        severity: "error",
        nodeKey: entry.nodeKey,
        message: `No §${sectionId ?? "?"} heading found in resolved COYOTE — ${entry.label} unreachable.`,
      });
    } else {
      definition = { state: "present", value: heading.title };
    }

    nodes.push({
      nodeKey: entry.nodeKey,
      kind: "intake",
      label: entry.label,
      canonRefs,
      sourceMeta,
      definition,
    });
  }

  return { nodes, diagnostics };
}
