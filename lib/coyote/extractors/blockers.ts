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

/**
 * A stable blocker id, if canon has started carrying one: "- **BLK-001** · text".
 *
 * §15 has none today — 0 of 47 rows — so every blocker is currently identified by its own
 * text, which means rewording a bullet orphans any state attached to it. The amendment
 * that fixes that is Shawn's to rule on (see scripts/propose-blocker-ids.ts, which writes
 * the patch and never touches COYOTE). Reading the id here first means the moment he lands
 * it, the id becomes the key with no second change and no migration; until then the
 * fallback below is exactly today's behaviour.
 *
 * The id deliberately carries no section number: §15 has moved before, and nodeRegistry.ts
 * already settled that section numbers are metadata and never identity.
 */
const BLOCKER_ID = /^\*\*(BLK-\d{3,})\*\*\s*[·:—-]?\s*(.*)$/;

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

    const bullet = bulletMatch[1].trim();
    if (bullet.length === 0) continue;

    // Strip the id off the text rather than leaving it inline, so the same blocker reads
    // identically whether or not canon has been amended yet — the id travels in `qId`.
    const idMatch = BLOCKER_ID.exec(bullet);
    const qId = idMatch?.[1];
    const text = idMatch ? idMatch[2].trim() : bullet;
    if (text.length === 0) continue;

    const matches = matchRegistryEntries(text);
    if (matches.length === 1) {
      items.push({ text, qId, sourceSection: currentSubheading, confidence: "matched", nodeKey: matches[0].nodeKey });
    } else {
      items.push({ text, qId, sourceSection: currentSubheading, confidence: "unattributed" });
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
