export type Shape = "box" | "circle" | "pill";

export type NodeState =
  | "UNTOUCHED"
  | "IN BUILD"
  | "BLOCKED"
  | "DONE"
  | "OUT OF SCOPE";

/** Every list item carries the section that declares it. */
export type Item = {
  text: string;
  done: boolean;
  sec: string;
};

/** A UI slot holds an image and nothing else. slot_index matters. */
export type Shot = {
  name: string;
  data: string | null;
  w?: number;
  h?: number;
};

/** A drop is arrival-ordered and takes any type. */
export type Drop = {
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
  subs: Item[];
  todos: Item[];
  blockers: Item[];
  /** fixed array of 4; empty slots are null */
  screens: (Shot | null)[];
  drops: Drop[];
};

export type Link = {
  a: string;
  b: string;
  /** the section that declares this edge */
  why?: string;
  /** §35.8 badge_awarded — drawn dashed in the field */
  back?: boolean;
  /** the wire a promoted sub-node keeps to its parent */
  fromPromote?: boolean;
};

export type TagKey = "screens" | "todos" | "blockers" | "drops" | "subs";

export type Nodes = Record<string, BrainNode>;
