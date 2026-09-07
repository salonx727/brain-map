import type { CanonicalNode } from "@/lib/types/canonicalNode";

// Shared by GraphCanvas (2D) and Wire3DField (3D) so a node with no saved
// pm_layout_positions row gets the exact same deterministic fallback coordinate in both
// views, instead of two views silently drifting apart. Never persisted — only used when
// `positions` has nothing for a node yet.
export const INTAKE_ORDER = ["intake:GATE", "intake:BOOKING"];
export const ENGINE_COLUMNS = 3;
export const COLUMN_SPACING = 230;
export const ENGINE_ROW_START_Y = 0;
export const ENGINE_ROW_SPACING = 170;
export const INTAKE_ROW_Y = ENGINE_ROW_START_Y + Math.ceil(11 / ENGINE_COLUMNS) * ENGINE_ROW_SPACING;
export const PM_ROW_Y = INTAKE_ROW_Y + ENGINE_ROW_SPACING;

export function computedGridPosition(nodeKey: string, engines: CanonicalNode[], intake: CanonicalNode[], pmIndex: number): { x: number; y: number } {
  const ei = engines.findIndex((n) => n.nodeKey === nodeKey);
  if (ei !== -1) return { x: (ei % ENGINE_COLUMNS) * COLUMN_SPACING, y: ENGINE_ROW_START_Y + Math.floor(ei / ENGINE_COLUMNS) * ENGINE_ROW_SPACING };
  const ii = INTAKE_ORDER.indexOf(nodeKey);
  if (ii !== -1) return { x: ii * COLUMN_SPACING, y: INTAKE_ROW_Y };
  return { x: pmIndex * COLUMN_SPACING, y: PM_ROW_Y };
}
