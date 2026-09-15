// The two people the map routes work to, and the rule that decides which.
//
// §15 and §00a both name plenty of work that names no engine, and the parser correctly
// refuses to guess one — it marks the item `unattributed` and moves on. That was the end
// of the road: 36 blockers and 87 questions existed in every published snapshot and
// appeared on no card, which is the same as not being on the map.
//
// Shawn's operator, 2026-09-13 — every line the brain yields, blocker or question, shows
// as BLK. TO DO is typed on a card and stored in pm_items only; nothing parsed from
// COYOTE ever lands there. A loose §15 blocker still defaults to Codeman. A loose §00a
// question defaults to Shawn. Either person can then move a line to the other — the
// move lives in pm_canon_assignments, never in COYOTE.
//
// An item that DOES name an engine never reaches here — it is already on that engine's
// BLK, questions included.
//
// The positions are the design sheet's own. seed.ts has carried a CODEMAN and a SHAWN
// counter at these exact coordinates since the prototype, showing hardcoded numbers with
// nothing behind them. The sheet reserved the spot; this fills it.

import type { Diagnostic, UnattributedItem } from "@/lib/types/canonicalNode";
import type { Shape } from "@/lib/types";

export type OwnerKey = "owner:shawn" | "owner:codeman";

export interface Owner {
  nodeKey: OwnerKey;
  /** The class marker on the card face, the way intake cards read `INT GATE`. */
  ref: string;
  /** The section this owner answers for — shown beside the ref, as an engine shows §35.x. */
  sec: string;
  name: string;
  shape: Shape;
  x: number;
  y: number;
  /** Which loose item lands here by default, before anyone moves it. */
  takes: UnattributedItem["kind"];
}

export const OWNERS: Owner[] = [
  { nodeKey: "owner:codeman", ref: "OWNER", sec: "§15", name: "CODEMAN", shape: "pill", x: -470, y: 1420, takes: "blocker" },
  { nodeKey: "owner:shawn", ref: "OWNER", sec: "§00a", name: "SHAWN", shape: "pill", x: 224, y: 1420, takes: "open question" },
];

export const OWNER_KEYS = OWNERS.map((o) => o.nodeKey);

export function isOwnerKey(nodeKey: string): nodeKey is OwnerKey {
  return nodeKey === "owner:shawn" || nodeKey === "owner:codeman";
}

/** Loose §15 work is build work → Codeman. Loose §00a work is canon → Shawn. */
export function defaultOwnerKey(kind: UnattributedItem["kind"]): OwnerKey {
  return kind === "blocker" ? "owner:codeman" : "owner:shawn";
}

export function otherOwnerKey(ownerKey: string): OwnerKey {
  return ownerKey === "owner:shawn" ? "owner:codeman" : "owner:shawn";
}

/**
 * Identity for a COYOTE line that has no pm_items row. Section + qId + text is enough
 * to find the same line after a reload or a republish; the unit separator cannot appear
 * in any of those fields as COYOTE writes them.
 */
export function itemFingerprint(item: { sourceSection: string; qId?: string; text: string }): string {
  return `${item.sourceSection}\u001f${item.qId ?? ""}\u001f${item.text}`;
}

/** Every loose item this snapshot found, in the order the parser reported them. */
export function unattributedFrom(diagnostics: Diagnostic[]): UnattributedItem[] {
  return diagnostics.flatMap((d) => (d.unattributed ? [d.unattributed] : []));
}
