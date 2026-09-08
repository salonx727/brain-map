import type { Nodes, NodeState, Shape, TagKey } from "./types";

/* Layout transcribed from the sheet. Nothing added to it.
   Composition is symmetric about x = 0. Column pitch 410 clears a 74px chip
   flank on both sides of every card. Left column and right column mirror; the
   centre column runs one row longer at each end, so the block reads balanced
   top to bottom as well.

   11 engines + 2 intake. No UNSPECIFIED slots — LOCK-260901-363 forbids
   pre-allocating them; a module exists when one is named. Claude Comm is held
   outside canon per LOCK-260901-367 and renders as such.
   Refs carry the class prefix — LOCK-260901-369. */
export const SEED: [string, Shape, number, number, string, string][] = [
  ["E01", "box", -470, 230, "GHOST NOTES", "§35.2"],
  ["E02", "box", -470, 460, "EMPIRE", "§35.3"],
  ["E03", "box", -470, 690, "MUSE", "§35.4"],

  ["E04", "box", -150, 0, "SIGNAL", "§35.5"],
  ["E05", "box", -150, 230, "RAMP", "§35.6"],
  ["E06", "box", -150, 460, "THE INK", "§35.7"],
  ["E07", "box", -150, 690, "AFTERBURNER", "§35.8"],
  ["E08", "box", -150, 920, "SKINZ", "§35.9"],

  ["E09", "box", 170, 230, "THE DIAL", "§35.10"],
  ["E10", "box", 170, 460, "TAG", "§35.11"],
  ["E11", "box", 170, 690, "NEXUS", "§35.12"],

  ["INT GATE", "circle", -470, 1180, "THE GATE", "§40"],
  ["INT BOOKING", "circle", 204, 1180, "BOOKING", "§39"],
];

/* Every edge cites the section that declares it. The fourth field marks the
   one backward edge (§35.8) so the field can draw it dashed. */
export const WIRES: [string, string, string, boolean?][] = [
  ["INT BOOKING", "E01", "§35.2 TRIGGER — booking created"],
  ["E01", "E02", "§35.2 EMITS — session_services, session_retail"],
  ["E01", "E03", "§35.2 EMITS — client_type NEW_CLIENT"],
  ["E01", "E05", "§35.2 EMITS — photos, services, back bar"],
  ["E01", "E06", "§35.2 EMITS — care_instructions"],
  ["E01", "E04", "§35.2 EMITS — rebook_confirmed"],
  ["E01", "E07", "§35.2 EMITS — rebook_confirmed"],
  ["E01", "E09", "§35.2 EMITS — full session record"],
  ["E01", "E11", "§35.2 EMITS — session_back_bar"],
  ["E02", "E11", "§35.3 DOWNSTREAM — economic layer only"],
  ["E03", "E11", "§35.4 DOWNSTREAM — Growth Path"],
  ["E10", "E04", "§35.5 READS — TAG findings"],
  ["E05", "E10", "§35.6 DOWNSTREAM — ramp-copy"],
  ["E05", "E11", "§35.6 DOWNSTREAM — post activity, CVM tier"],
  ["E06", "E05", "§35.7 DOWNSTREAM — Magic Selfie Loop"],
  ["E06", "E11", "§35.7 DOWNSTREAM — client nodes"],
  ["E10", "E07", "§35.8 READS — TAG attribution chain"],
  ["E07", "E01", "§35.8 WRITES — badge_awarded, the only backward edge", true],
  ["E08", "E11", "§35.9 DOWNSTREAM — tribe colour on every node"],
  ["E09", "E11", "§35.10 DOWNSTREAM — retention curves, projections"],
  ["E10", "E11", "§35.11 DOWNSTREAM — network position"],
];

/* CODEMAN and SHAWN were two counters here with their MESSAGES and TO DO totals typed
   in by hand. They are real cards now and count their own work — see lib/owners.ts,
   which keeps these exact coordinates. */

export const TAGS: { key: TagKey; label: string }[] = [
  { key: "screens", label: "UI" },
  { key: "todos", label: "TO DO" },
  { key: "blockers", label: "BLK" },
  { key: "drops", label: "DROP" },
  { key: "subs", label: "SUB" },
];

export const SIZE: Record<Shape, [number, number]> = {
  box: [190, 116],
  circle: [168, 168],
  pill: [320, 84],
};

/** The same five words everywhere on the map. */
export const STATES: NodeState[] = [
  "UNTOUCHED",
  "IN BUILD",
  "BLOCKED",
  "DONE",
  "OUT OF SCOPE",
];

export function buildSeedNodes(): { nodes: Nodes; order: string[]; byRef: Record<string, string> } {
  const nodes: Nodes = {};
  const order: string[] = [];
  const byRef: Record<string, string> = {};
  SEED.forEach((s, i) => {
    const id = "n" + i;
    nodes[id] = {
      id,
      ref: s[0],
      shape: s[1],
      x: s[2],
      y: s[3],
      name: s[4] || "",
      sec: s[5] || "",
      color: null,
      state: "UNTOUCHED",
      origin: "canon",
      subs: [],
      todos: [],
      blockers: [],
      screens: [],
      drops: [],
    };
    byRef[s[0]] = id;
    order.push(id);
  });
  return { nodes, order, byRef };
}
