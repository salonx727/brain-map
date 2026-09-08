// The two people the map routes work to, and the rule that decides which.
//
// §15 and §00a both name plenty of work that names no engine, and the parser correctly
// refuses to guess one — it marks the item `unattributed` and moves on. That was the end
// of the road: 36 blockers and 87 questions existed in every published snapshot and
// appeared on no card, which is the same as not being on the map.
//
// They are not homeless, though; they are just not an engine's. Read them and the split
// is obvious. §15's loose blockers name files, tables and endpoints — "dropQueue uses
// Pool A connection, fix one line in drop_engine.js", "founder_registry table + seed".
// That is build work. §00a's loose questions name rulings — "Content ruling", "Founder
// confirmation required", "Whether a permission resolves against a module". That is
// canon, and canon has exactly one author (CLAUDE.md: Claude proposes, Shawn decides).
//
// So the routing rule is the section, not a keyword list that would need maintaining:
// a loose blocker is Codeman's, a loose question is Shawn's. An item that DOES name an
// engine never reaches here — it is already on that engine's card.
//
// The positions are the design sheet's own. seed.ts has carried a CODEMAN and a SHAWN
// counter at these exact coordinates since the prototype, showing hardcoded numbers with
// nothing behind them. The sheet reserved the spot; this fills it.

import type { Diagnostic, UnattributedItem } from "@/lib/types/canonicalNode";
import type { Shape } from "@/lib/types";

export interface Owner {
  nodeKey: string;
  /** The class marker on the card face, the way intake cards read `INT GATE`. */
  ref: string;
  /** The section this owner answers for — shown beside the ref, as an engine shows §35.x. */
  sec: string;
  name: string;
  shape: Shape;
  x: number;
  y: number;
  /** Which loose item lands here. */
  takes: UnattributedItem["kind"];
}

export const OWNERS: Owner[] = [
  { nodeKey: "owner:codeman", ref: "OWNER", sec: "§15", name: "CODEMAN", shape: "pill", x: -470, y: 1420, takes: "blocker" },
  { nodeKey: "owner:shawn", ref: "OWNER", sec: "§00a", name: "SHAWN", shape: "pill", x: 224, y: 1420, takes: "open question" },
];

export const OWNER_KEYS = OWNERS.map((o) => o.nodeKey);

export function isOwnerKey(nodeKey: string): boolean {
  return nodeKey.startsWith("owner:");
}

/** Every loose item this snapshot found, in the order the parser reported them. */
export function unattributedFrom(diagnostics: Diagnostic[]): UnattributedItem[] {
  return diagnostics.flatMap((d) => (d.unattributed ? [d.unattributed] : []));
}
