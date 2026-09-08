// Shared full-diagnostics assembly. Used by both the dev-path reader
// (getCanonicalGraph.ts, reading the local resolver directly) and the publish path
// (publisher.ts, writing canonical_snapshots.diagnostics) so a published snapshot's
// diagnostics always match what the local dev path would have rendered for the same
// parse — otherwise the Global Diagnostics Tray goes quiet the moment the app switches
// from the local resolver to the Supabase-backed production read path.
//
// Kept out of parser.ts itself: AttributedItem -> Diagnostic conversion is a
// presentation decision (Phase 3's Diagnostics Tray only renders Diagnostic[]), not a
// parsing concern — the parser still returns the full, untouched AttributedItem[] lists.

import type { AttributedItem, Diagnostic } from "@/lib/types/canonicalNode";

function unattributedItemToDiagnostic(item: AttributedItem, kind: "blocker" | "open question"): Diagnostic {
  const idPrefix = item.qId ? `${item.qId} — ` : "";
  return {
    severity: "warning",
    message: `Unattributed ${kind} (${item.sourceSection}): ${idPrefix}${item.text}`,
    // The same fact in a shape a UI can place. The message stays exactly as it was —
    // it is what a diagnostics reader shows — and this rides along for the owner cards.
    unattributed: {
      kind,
      text: item.text,
      sourceSection: item.sourceSection,
      ...(item.qId ? { qId: item.qId } : {}),
      ...(item.status ? { status: item.status } : {}),
    },
  };
}

export function buildFullDiagnostics(parsed: {
  diagnostics: Diagnostic[];
  blockers: AttributedItem[];
  openQuestions: AttributedItem[];
}): Diagnostic[] {
  const unattributed = [
    ...parsed.blockers.filter((b) => b.confidence === "unattributed").map((b) => unattributedItemToDiagnostic(b, "blocker")),
    ...parsed.openQuestions.filter((q) => q.confidence === "unattributed").map((q) => unattributedItemToDiagnostic(q, "open question")),
  ];
  return [...parsed.diagnostics, ...unattributed];
}
