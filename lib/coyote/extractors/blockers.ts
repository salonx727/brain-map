// Extracts bulleted items from §15 (Open Build Items) and attributes each to an engine
// by best-effort name matching. §15 is not engine-keyed — it's a flat set of subsections
// (Launch Blockers, High-Risk, Remaining Pre-Launch Build, V2 Open Items, etc.) — so
// attribution is a heuristic, never a guaranteed FK. Items with zero or >1 alias match
// are `unattributed`, the >1 case additionally producing a diagnostic (ambiguous, not
// guessed).
//
// Note: §15's one classification table ("V1 / V2 Classification Updates") is not a
// bullet list and is not extracted here — out of scope for this pass, not a defect.

import type { AttributedItem, Diagnostic } from "@/lib/types/canonicalNode";
import { matchRegistryEntries } from "@/lib/coyote/nodeRegistry";

const SECTION_LABEL = "§15";

export function extractBlockers(section15Lines: string[] | undefined): { items: AttributedItem[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (!section15Lines) {
    diagnostics.push({ severity: "error", message: "§15 not found in resolved COYOTE — blockers unreachable." });
    return { items: [], diagnostics };
  }

  const items: AttributedItem[] = [];
  let currentSubheading = SECTION_LABEL;

  for (const raw of section15Lines) {
    const line = raw.trim();
    const headingMatch = /^#{3}\s+(.*)$/.exec(line);
    if (headingMatch) {
      currentSubheading = `${SECTION_LABEL} › ${headingMatch[1].trim()}`;
      continue;
    }
    const bulletMatch = /^[-*]\s+(.*)$/.exec(line);
    if (!bulletMatch) continue;

    const text = bulletMatch[1].trim();
    if (text.length === 0) continue;

    const matches = matchRegistryEntries(text);
    if (matches.length === 1) {
      items.push({ text, sourceSection: currentSubheading, confidence: "matched", nodeKey: matches[0].nodeKey });
    } else {
      items.push({ text, sourceSection: currentSubheading, confidence: "unattributed" });
      if (matches.length > 1) {
        diagnostics.push({
          severity: "warning",
          message: `Ambiguous blocker attribution — "${text}" matches ${matches.map((m) => m.nodeKey).join(", ")}. Left unattributed rather than guessed.`,
        });
      }
    }
  }

  return { items, diagnostics };
}
