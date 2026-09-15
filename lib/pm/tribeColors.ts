// The 15-colour Tribe roster, spectrum order — a fixed UI palette constant, not
// canonical node/connection data. Matches Shawn's reference surface exactly (hex-for-
// hex) so a colour picked here means the same thing it would mean anywhere else in the
// product. Stored as a stable `key` (not an array index) in `pm_layout_positions.color`,
// so re-ordering this list later can never silently reassign a node's colour.

export interface TribeColor {
  key: string;
  label: string;
  hex: string | null; // null = PRISM, rendered as an iridescent ring, no flat fill
}

export const TRIBE_COLORS: TribeColor[] = [
  { key: "01", label: "PLASMA", hex: "#B45CFF" },
  { key: "02", label: "INDIGO", hex: "#6366F1" },
  { key: "03", label: "COBALT", hex: "#2541E8" },
  { key: "04", label: "CYBER", hex: "#2EB6FF" },
  { key: "05", label: "TEAL", hex: "#14D4C3" },
  { key: "06", label: "EMERALD", hex: "#10D982" },
  { key: "07", label: "VOLTAGE", hex: "#C6FF3D" },
  { key: "08", label: "GOLD", hex: "#FFD60A" },
  { key: "09", label: "SOLAR", hex: "#FF8A14" },
  { key: "10", label: "CRIMSON", hex: "#FF3B5C" },
  { key: "11", label: "MAGENTA", hex: "#FF2EBA" },
  { key: "12", label: "PLATINUM", hex: "#C7CAD1" },
  { key: "13", label: "ONYX", hex: "#3F3F46" },
  { key: "14", label: "SNOW", hex: "#FFFFFF" },
  { key: "15", label: "PRISM", hex: null },
];

export const PRISM_GRADIENT = "conic-gradient(#B45CFF,#2EB6FF,#C6FF3D,#FF2EBA,#B45CFF)";

export function findTribeColor(hex: string | null | undefined): TribeColor | null {
  if (!hex) return null;
  return TRIBE_COLORS.find((c) => c.hex === hex) ?? null;
}

export function findTribeColorByKey(key: string | null | undefined): TribeColor | null {
  if (!key) return null;
  return TRIBE_COLORS.find((c) => c.key === key) ?? null;
}

/**
 * The color a new node gets automatically, so a card someone just made is never the same
 * hue as one already on the field. Cycles PLASMA→...→SNOW in spectrum order, skipping
 * PRISM (key 15 — no flat hex, nothing for a flat-fill consumer like Field3D to render)
 * and skipping every key already in use. Once all fourteen flat colors are taken, the
 * (rare, 2-3-person-scale) fifteenth-plus new node repeats from the top rather than
 * erroring — a repeated color is a smaller problem than a card with none at all.
 */
export function nextUnusedTribeColor(usedKeys: Iterable<string>): TribeColor {
  const used = new Set(usedKeys);
  const eligible = TRIBE_COLORS.filter((c) => c.hex !== null);
  return eligible.find((c) => !used.has(c.key)) ?? eligible[used.size % eligible.length];
}

// Filled-surface card treatment (approved colour study, 2026-09-05): a coloured card
// gets a deep tint of its Tribe Colour as the surface, and bright/dim tints of the same
// hue for ink — never a flat grey card with just a coloured border. `mix` blends toward
// black (the tinted surface), `lift` blends toward white (the tinted ink). Same math as
// the study, so a hex here reads exactly as it did there.
function mix(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r}, ${g}, ${b})`;
}
function lift(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgb(${Math.round(r + (255 - r) * k)}, ${Math.round(g + (255 - g) * k)}, ${Math.round(b + (255 - b) * k)})`;
}

export interface CardTint {
  bg: string;
  bgHover: string;
  ink: string;
  dim: string;
}

/** null for PRISM (no flat hex to tint from) and for no colour assigned — callers fall
 * back to the card's default hairline treatment in both cases. */
export function tintFor(hex: string | null | undefined): CardTint | null {
  if (!hex) return null;
  return {
    bg: mix(hex, 0.3),
    bgHover: mix(hex, 0.38),
    ink: lift(hex, 0.55),
    dim: lift(hex, 0.2),
  };
}
