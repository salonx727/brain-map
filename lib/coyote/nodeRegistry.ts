// The fixed, stable node-identity registry. This is NOT derived from COYOTE headings —
// the parser populates a known key with what it finds; it never mints a new key from a
// heading. Section numbers/LOCK ids/Q-ids are metadata (CanonRef), never identity, so a
// future COYOTE resequencing fold can't orphan a Supabase PM row keyed on `node_key`.
//
// Modules and Stages are deliberately absent — taxonomy unruled (Shawn's call pending).
// `microsite:main` is reserved per Codeman's Phase 2 approval but not implemented this
// phase: `implemented: false` means no extractor populates or attributes against it.

import type { NodeKind } from "@/lib/types/canonicalNode";

export interface NodeRegistryEntry {
  nodeKey: string;
  kind: NodeKind;
  label: string;
  /** Distinctive name/code forms used for heading anchoring and prose attribution matching. */
  aliases: string[];
  implemented: boolean;
}

export const NODE_REGISTRY: NodeRegistryEntry[] = [
  { nodeKey: "screen:S0", kind: "screen", label: "S0 — The Marquee", aliases: ["S0", "The Marquee", "Marquee"], implemented: true },
  { nodeKey: "screen:S1", kind: "screen", label: "S1 — Dashboard", aliases: ["S1"], implemented: true },
  { nodeKey: "screen:S2", kind: "screen", label: "S2 — Client", aliases: ["S2"], implemented: true },
  { nodeKey: "screen:S3", kind: "screen", label: "S3 — Calendar", aliases: ["S3"], implemented: true },
  { nodeKey: "screen:S4", kind: "screen", label: "S4 — The Climax", aliases: ["S4", "The Climax"], implemented: true },
  { nodeKey: "screen:S5", kind: "screen", label: "S5 — Client Care Card", aliases: ["S5", "Client Care Card"], implemented: true },
  { nodeKey: "microsite:main", kind: "screen", label: "MICROSITE", aliases: ["MICROSITE"], implemented: false },

  { nodeKey: "engine:E01", kind: "engine", label: "E01 — Ghost Notes", aliases: ["E01", "GHOST NOTES"], implemented: true },
  { nodeKey: "engine:E02", kind: "engine", label: "E02 — Empire", aliases: ["E02", "EMPIRE"], implemented: true },
  { nodeKey: "engine:E03", kind: "engine", label: "E03 — Muse", aliases: ["E03", "MUSE"], implemented: true },
  { nodeKey: "engine:E04", kind: "engine", label: "E04 — Signal", aliases: ["E04", "SIGNAL"], implemented: true },
  { nodeKey: "engine:E05", kind: "engine", label: "E05 — Ramp", aliases: ["E05", "RAMP"], implemented: true },
  { nodeKey: "engine:E06", kind: "engine", label: "E06 — The Ink", aliases: ["E06", "THE INK"], implemented: true },
  { nodeKey: "engine:E07", kind: "engine", label: "E07 — Afterburner", aliases: ["E07", "AFTERBURNER"], implemented: true },
  { nodeKey: "engine:E08", kind: "engine", label: "E08 — Skinz", aliases: ["E08", "SKINZ"], implemented: true },
  { nodeKey: "engine:E09", kind: "engine", label: "E09 — The Dial", aliases: ["E09", "THE DIAL"], implemented: true },
  { nodeKey: "engine:E10", kind: "engine", label: "E10 — Tag", aliases: ["E10", "TAG"], implemented: true },
  { nodeKey: "engine:E11", kind: "engine", label: "E11 — Nexus", aliases: ["E11", "NEXUS"], implemented: true },

  // §39 BOOKING and §40 THE GATE — declared intake objects (LOCK-260901-369's `INT` class
  // prefix). Added 2026-09-03: previously absent entirely, which left the canonical edge
  // `INT BOOKING → E01` (§35.2's own TRIGGER) with no node to resolve against — flagged
  // 2026-09-01 and confirmed still true in Codeman's Sep 3 handoff before this fix.
  { nodeKey: "intake:GATE", kind: "intake", label: "INT GATE — The Gate", aliases: ["THE GATE", "INT GATE"], implemented: true },
  { nodeKey: "intake:BOOKING", kind: "intake", label: "INT BOOKING — Booking", aliases: ["INT BOOKING", "BOOKING"], implemented: true },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Best-effort name attribution. Returns every registry entry whose alias appears as a
 * whole word in `text` — callers decide what a single vs. multiple match means (Phase 2's
 * parser treats >1 match as ambiguous, never guesses one).
 */
export function matchRegistryEntries(text: string): NodeRegistryEntry[] {
  const matches: NodeRegistryEntry[] = [];
  for (const entry of NODE_REGISTRY) {
    if (!entry.implemented) continue;
    const hit = entry.aliases.some((alias) => new RegExp(`\\b${escapeRegExp(alias)}\\b`, "i").test(text));
    if (hit) matches.push(entry);
  }
  return matches;
}
