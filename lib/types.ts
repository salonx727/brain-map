import type { ConnectionRelation, PmRuling } from "@/lib/types/pm";
import type { EvidenceClass } from "@/lib/types/canonicalNode";

export type Shape = "box" | "circle" | "pill";

export type NodeState =
  | "UNTOUCHED"
  | "IN BUILD"
  | "BLOCKED"
  | "DONE"
  | "OUT OF SCOPE";

/* The optional `id`/`storagePath` fields below are the only change this file needed to
   sit on a real backend. The prototype identified an item by its position in an array,
   which is identity enough for one localStorage blob and not enough to update the right
   row. They are optional so every component that never reads them stays untouched, and
   so an item the user just typed — real, but not yet written — is still a valid Item. */

/** Every list item carries the section that declares it. */
export type Item = {
  /** A real pm_items.id once persisted; absent while the item is new. */
  id?: string;
  text: string;
  done: boolean;
  sec: string;
  /**
   * Declared by COYOTE (§15 blockers, §00a open questions) rather than typed here, so it
   * is shown and never edited: it has no pm_items row to address, and the next publish
   * would restore it anyway. Same posture as a canon wire — see adapter.ts.
   */
  canon?: boolean;
};

/** A UI slot holds an image and nothing else. slot_index matters. */
export type Shot = {
  id?: string;
  storagePath?: string;
  name: string;
  data: string | null;
  w?: number;
  h?: number;
};

/** A drop is arrival-ordered and takes any type. */
export type Drop = {
  id?: string;
  storagePath?: string;
  name: string;
  size: number | null;
  type?: string;
  data: string | null;
};

export type BrainNode = {
  id: string;
  ref: string;
  shape: Shape;
  x: number;
  y: number;
  name: string;
  sec: string;
  color: number | null;
  state: NodeState;
  /** canon cards are never removable in one touch; user cards are */
  origin: "canon" | "user";
  /**
   * A ruling is open on this card — Shawn has not ruled yet, so it exists on the map but
   * not in canon. Deliberately NOT a sixth `NodeState`: work state describes build
   * progress, and a card can honestly be IN BUILD while still awaiting a ruling. Derived
   * from pm_rulings each render, never stored.
   */
  awaitingRuling?: boolean;
  /** The RUL-014 handle shown beside the marker, when one is open. */
  rulingRef?: string;
  subs: Item[];
  todos: Item[];
  blockers: Item[];
  /** fixed array of 4; empty slots are null */
  screens: (Shot | null)[];
  drops: Drop[];
};

export type Link = {
  /** A real pm_node_links.id for a user-drawn wire. Canonical edges come from COYOTE and
   * have none — they are not rows anyone can delete from here. */
  id?: string;
  /** True for an edge declared by COYOTE itself: read-only, never removable in the UI. */
  canon?: boolean;
  a: string;
  b: string;
  /** the section that declares this edge */
  why?: string;
  /** §35.8 badge_awarded — drawn dashed in the field */
  back?: boolean;
  /** the wire a promoted sub-node keeps to its parent */
  fromPromote?: boolean;
  /**
   * Synthesized from a PM node's parent_node_key, not a pm_node_links row — so it has no
   * `id` and nothing to delete. PM-only: §42.7 forbids drawing a canonical module's
   * containment as a wire, and this flag never applies to a `canon` link. Field3D draws it
   * distinctly (dim, no light-pulse) so nesting reads as nesting, not as a real data-flow edge.
   */
  containment?: boolean;
  /**
   * Which §35 field this wire asserts. Set on a canon edge from how the parser read it,
   * and on a PM wire from what the person drawing it picked. Undefined for a containment
   * wire, which asserts nothing.
   */
  relation?: ConnectionRelation;
  /**
   * `inferred` — canon carries this edge only because the TARGET's READS names the source,
   * not because the source declared it. Drawn distinctly: an inference and a declaration
   * looking identical is what made the distinction uncheckable before 0010.
   */
  evidence?: EvidenceClass;
  /**
   * A PM wire whose ruling is still open. Drawn as a proposal, never as canon — the whole
   * point is that a drawn edge must not read as a declared one until Shawn has ruled.
   */
  awaitingRuling?: boolean;
  rulingRef?: string;
};

export type TagKey = "screens" | "todos" | "blockers" | "drops" | "subs";

export type Nodes = Record<string, BrainNode>;

/** The whole arrangement. Built server-side from canonical + PM data (lib/adapter.ts) and
 * handed to BrainProvider, which is why it lives here and not in the client module. */
export type Model = {
  nodes: Nodes;
  order: string[];
  links: Link[];
  /** unrouted is a state, not an error */
  unrouted: Drop[];
  /** Open rulings, newest first — the queue rendered on Shawn's card. */
  rulings: PmRuling[];
};
