// Shared PM-display computations — used by both GraphCanvas (desktop) and
// MobileNodeList (mobile) so a sub-node count is never computed two different ways in
// two different places. Client-safe (no I/O, no Supabase import).
//
// chipCountsFor (UI/TO DO/BLK/DROP/WIRE counts) was removed here 2026-09-05 along with
// the on-card chip rail it fed — v5.2's correction moved all five counts into the
// control surface's own tab strip, which DetailPanel computes locally. Not restored as
// an at-a-glance indicator per Shawn's explicit instruction; if that's ever wanted back,
// this is where the shared computation belongs again.

import type { PmLayer } from "@/lib/types/pm";

export function subCountFor(nodeKey: string, pm: PmLayer): number {
  return pm.nodes.filter((n) => n.parentNodeKey === nodeKey).length;
}

/**
 * Attention marks — solid dot (blocked) / hollow dot (has other work), shown only at
 * overview zoom (see GraphCanvas.tsx's FAR_ZOOM_THRESHOLD), replacing detail that would
 * otherwise shrink illegibly (Shawn's "TEXT SCALES AGAINST ZOOM" ruling,
 * NOTE_PERSISTENCE.txt). This is NOT the removed chip rail above — two binary signals,
 * not five per-category counts, and invisible except when zoomed far out.
 */
export function attentionFor(nodeKey: string, pm: PmLayer): { blocked: boolean; hasWork: boolean } {
  const items = pm.items.filter((i) => i.nodeKey === nodeKey);
  const blocked = items.some((i) => i.kind === "blocker" && i.status !== "done");
  const openTodo = items.some((i) => i.kind === "todo" && i.status !== "done");
  const hasFiles = pm.files.some((f) => f.nodeKey === nodeKey);
  const hasWork = openTodo || hasFiles || subCountFor(nodeKey, pm) > 0;
  return { blocked, hasWork };
}
