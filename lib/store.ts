import type { BrainNode, Drop, Link, Nodes, Shape, Shot } from "./types";

/* ---------------- persistence ----------------
   An arrangement holds. Only an explicit RESET undoes it, and if the stored
   layout cannot be read we say so and change nothing — we never silently
   substitute the seed. Images are not stored: a few phone photos would
   exhaust the quota and evict the arrangement, which is the one thing that
   must survive. */
export const STORE = "salonx-brain-map-v1";

export function stripData(f: Drop): Drop {
  return { name: f.name, size: f.size, type: f.type, data: null };
}

type SavedNode = {
  ref: string;
  sec?: string;
  name: string;
  shape: Shape;
  x: number;
  y: number;
  state: BrainNode["state"];
  origin: BrainNode["origin"];
  todos: BrainNode["todos"];
  blockers: BrainNode["blockers"];
  subs: BrainNode["subs"];
  drops: Drop[];
  /* filenames and sizes persist; the pictures do not */
  screens: (Shot | null)[];
};

type SavedMap = {
  v: number;
  saved: number;
  nodes: Record<string, SavedNode>;
  order: string[];
  links: Link[];
  unrouted: Drop[];
};

export type LoadResult =
  | { ok: true; nodes: Nodes; order: string[]; links: Link[] | null; unrouted: Drop[] | null }
  /** nothing saved yet — the cards stand at their seed positions, empty */
  | { ok: false; note: "" }
  /** a save exists but cannot be used. Say so, change nothing. */
  | { ok: false; note: string };

export type SaveState = { storeOK: boolean; note: string };

export function saveMap(
  nodes: Nodes,
  order: string[],
  links: Link[],
  unrouted: Drop[]
): SaveState {
  try {
    const out: SavedMap = {
      v: 1,
      saved: Date.now(),
      nodes: {},
      order: order.slice(),
      links,
      unrouted: unrouted.map(stripData),
    };
    order.forEach((id) => {
      const d = nodes[id];
      if (!d) return;
      out.nodes[id] = {
        ref: d.ref,
        sec: d.sec,
        name: d.name,
        shape: d.shape,
        x: d.x,
        y: d.y,
        state: d.state,
        origin: d.origin || "canon",
        todos: d.todos,
        blockers: d.blockers,
        subs: d.subs,
        drops: d.drops.map(stripData),
        /* the pictures do not persist; the filenames and sizes do */
        screens: d.screens.map((sc) =>
          sc ? { name: sc.name, w: sc.w, h: sc.h, data: null } : null
        ),
      };
    });
    localStorage.setItem(STORE, JSON.stringify(out));
    return { storeOK: true, note: "" };
  } catch (err) {
    const name = err instanceof Error && err.name ? err.name : "STORAGE UNAVAILABLE";
    return { storeOK: false, note: "LAYOUT NOT SAVED · " + name };
  }
}

export function loadMap(seedNodes: Nodes, seedOrder: string[]): LoadResult {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORE);
  } catch {
    return { ok: false, note: "STORAGE UNAVAILABLE" };
  }
  if (!raw) return { ok: false, note: "" };

  let saved: SavedMap;
  try {
    saved = JSON.parse(raw);
  } catch {
    /* unreadable — say so, change nothing */
    return { ok: false, note: "SAVED LAYOUT UNREADABLE · NOTHING CHANGED" };
  }
  if (!saved || !saved.nodes) {
    return { ok: false, note: "SAVED LAYOUT INCOMPLETE · NOTHING CHANGED" };
  }

  const nodes = seedNodes;
  const order = seedOrder.slice();

  Object.keys(saved.nodes).forEach((id) => {
    const sv = saved.nodes[id];
    const d = nodes[id];
    if (d) {
      d.x = sv.x;
      d.y = sv.y;
      d.state = sv.state || d.state;
      d.origin = sv.origin || d.origin || "canon";
      d.ref = sv.ref || d.ref;
      d.name = sv.name != null ? sv.name : d.name;
      d.todos = sv.todos || [];
      d.blockers = sv.blockers || [];
      d.subs = sv.subs || [];
      d.drops = sv.drops || [];
      d.screens = sv.screens || [];
    } else {
      /* a card created in a past session */
      nodes[id] = {
        id,
        ref: sv.ref,
        sec: sv.sec || "",
        name: sv.name,
        shape: sv.shape || "box",
        x: sv.x,
        y: sv.y,
        state: sv.state || "UNTOUCHED",
        origin: sv.origin || "user",
        color: null,
        todos: sv.todos || [],
        blockers: sv.blockers || [],
        subs: sv.subs || [],
        drops: sv.drops || [],
        screens: sv.screens || [],
      };
      order.push(id);
    }
  });

  /* a node in the seed but not in the save has never been placed — it keeps
     its seed position. That is placement, not reset. */
  return {
    ok: true,
    nodes,
    order,
    links: saved.links || null,
    unrouted: saved.unrouted || null,
  };
}

export function clearStore(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* nothing to clear */
  }
}
