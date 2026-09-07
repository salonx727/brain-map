import type { Item, Nodes, NodeState, Shape, TagKey } from "./types";

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

export const COUNTERS: [string, number, number, number, number][] = [
  ["Codeman", 3, 6, -470, 1420],
  ["Shawn", 2, 21, 224, 1420],
];

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

/* ---------------- sample data ----------------
   Loaded ONLY when there is no saved map, so it can never overwrite work.
   Every line is drawn from the §35 spine contracts — canon text, not invented
   project status. RESET clears it. */
function t(text: string, sec?: string, done?: boolean): Item {
  return { text, done: !!done, sec: sec || "" };
}

type Sample = { state?: NodeState; todos?: Item[]; blockers?: Item[]; subs?: Item[] };

const SAMPLE: Record<string, Sample> = {
  n0: {
    state: "IN BUILD",
    todos: [
      t("Confirm session_services and session_retail reach EMPIRE", "§35.2 EMITS"),
      t("client_type NEW_CLIENT handoff to MUSE", "§35.4 DOWNSTREAM"),
      t("Photos and back bar arriving", "§35.2 EMITS", true),
    ],
    blockers: [
      t("badge_awarded write is the only backward edge — confirm it is safe", "§35.8 WRITES"),
    ],
    subs: [t("Session record assembler")],
  },
  n1: {
    state: "IN BUILD",
    todos: [t("Economic layer only — nothing else downstream", "§35.3 DOWNSTREAM")],
  },
  n2: {
    state: "UNTOUCHED",
    subs: [t("Growth Path renderer"), t("New-client detection")],
  },
  n4: {
    state: "BLOCKED",
    todos: [
      t("Ramp-copy handoff to TAG needs the attribution chain wired", "§35.6 DOWNSTREAM"),
      t("Magic Selfie Loop arrives from THE INK — confirm the trigger", "§35.7 DOWNSTREAM"),
      t("CVM tier reads the old post-activity shape", "§35.6 DOWNSTREAM"),
      t("Post activity feed shape agreed", "§35.6 DOWNSTREAM", true),
    ],
    blockers: [
      t("TAG findings are not reaching SIGNAL", "§35.5 READS"),
      t("Attribution chain unresolved", "§35.8 READS"),
    ],
    subs: [t("Ramp copy service")],
  },
  n5: {
    state: "IN BUILD",
    todos: [t("care_instructions arriving from GHOST NOTES", "§35.2 EMITS")],
    blockers: [t("Client nodes downstream of NEXUS undefined", "§35.7 DOWNSTREAM")],
  },
  n9: {
    state: "IN BUILD",
    todos: [t("Network position calculation", "§35.11 DOWNSTREAM")],
    subs: [t("Attribution chain reader")],
  },
  n10: {
    state: "BLOCKED",
    blockers: [
      t("Eight upstream engines land here — none of the contracts are confirmed", "§35.12"),
      t("Tribe colour on every node depends on SKINZ, disabled at launch", "§35.9"),
    ],
  },
  n11: {
    state: "DONE",
    todos: [t("Client records written at import", "§40", true)],
  },
  n12: {
    state: "DONE",
    todos: [t("Booking created fires GHOST NOTES", "§35.2 TRIGGER", true)],
  },
};

export function seedSample(nodes: Nodes): void {
  Object.keys(SAMPLE).forEach((id) => {
    const d = nodes[id];
    if (!d) return;
    const sv = SAMPLE[id];
    d.state = sv.state || d.state;
    d.todos = sv.todos || [];
    d.blockers = sv.blockers || [];
    d.subs = sv.subs || [];
  });
}
