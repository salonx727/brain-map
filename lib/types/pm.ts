// Shared types for the writable PM layer. Deliberately separate from canonicalNode.ts —
// nothing here is ever merged into a CanonicalNode; see EnrichedNode in getPmLayer.ts for
// the one place the two are allowed to sit next to each other, always nested.

export interface PmPerson {
  id: string;
  name: string;
  createdAt: string;
}

export type PmNodeKind = "subnode" | "function";

/**
 * A PM-created custom node. Never a canonical Screen/Engine/Intake/Module — no write path
 * to those exists anywhere in this module. `nodeKey` (`pm:<uuid>`) is the permanent
 * identity and is NEVER shown to a user — `displayRef` (e.g. `SUB-1`, `FN-1`) is the
 * human-readable handle, assigned once at creation. Confusing the two was a confirmed
 * display defect (a raw uuid leaking onto a card face); see 0004_pm_node_display_ref.sql.
 */
export interface PmNode {
  nodeKey: string;
  displayRef: string;
  parentNodeKey: string | null;
  label: string;
  kind: PmNodeKind;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export type PmItemKind = "todo" | "blocker";

/** GTD's own vocabulary (gtd/*.md), not a generic ticket lifecycle — see migration comment. */
export type PmItemStatus = "inbox" | "next_action" | "waiting_for" | "someday_maybe" | "done";

export interface PmItem {
  id: string;
  nodeKey: string | null;
  kind: PmItemKind;
  title: string;
  detail: string | null;
  status: PmItemStatus;
  waitingOn: string | null;
  ownerId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export type PmNoteKind = "note" | "decision";

/** A PM note/decision — never a COYOTE decision record. See migration comment. */
export interface PmNote {
  id: string;
  nodeKey: string | null;
  kind: PmNoteKind;
  body: string;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export type PmReferenceType = "figma" | "wireframe" | "ui_slot" | "link";

export interface PmReference {
  id: string;
  nodeKey: string;
  refType: PmReferenceType;
  label: string | null;
  url: string;
  createdBy: string | null;
  createdAt: string;
}

/**
 * Metadata only — bytes live in the private `pm-files` Storage bucket. nodeKey === null
 * means UNSORTED. slotIndex is null for an ordinary DROP-tab file; 0–3 for one of the
 * four fixed UI-tab image slots (matching Shawn's intake reference exactly — a slot
 * holds exactly one file, never more, enforced by a DB unique index, not just the UI).
 */
export interface PmFile {
  id: string;
  nodeKey: string | null;
  storagePath: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  slotIndex: number | null;
  createdBy: string | null;
  createdAt: string;
}

export interface PmLayout {
  id: string;
  name: string;
  isDefault: boolean;
  createdBy: string | null;
  createdAt: string;
}

/**
 * Deliberately carries no `locked` field — layout lock is session-only per Shawn's
 * ruling and is never persisted here. See 0002_pm_layer.sql's header comment.
 */
export interface PmLayoutPosition {
  layoutId: string;
  nodeKey: string;
  x: number;
  y: number;
  color: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

/** A connection where at least one endpoint is a PM-created node — enforced by a DB trigger, not just this type. */
export interface PmNodeLink {
  id: string;
  fromNodeKey: string;
  toNodeKey: string;
  citation: string | null;
  createdBy: string | null;
  createdAt: string;
}

export type PmNodeWorkState = "UNTOUCHED" | "IN_BUILD" | "BLOCKED" | "DONE" | "OUT_OF_SCOPE";

/**
 * One global work-state per node_key, independent of any named layout — a fact about the
 * node, not about how it's arranged on screen. See 0006_pm_node_state.sql's header
 * comment for why this is a separate table from PmLayoutPosition rather than a column on
 * it. Absence means UNTOUCHED (the table's own default); a node with no row here is not a
 * different case from one with state: "UNTOUCHED" — see pmDisplay.ts's resolver.
 */
export interface PmNodeState {
  nodeKey: string;
  state: PmNodeWorkState;
  updatedBy: string | null;
  updatedAt: string;
}

export type RulingStatus = "pending" | "ruled" | "rejected";

/**
 * What a card is proposing about its own connections, in COYOTE's own §35 vocabulary —
 * the same four fields connections.ts already reads, so a ruling is phrased in the
 * language Shawn writes canon in. Free text throughout: this is a proposal a human typed,
 * not a resolved edge, and nothing here is validated against the node registry.
 */
export interface ConnectionIntent {
  downstream: string | null;
  reads: string | null;
  emits: string | null;
  trigger: string | null;
}

/**
 * One ruling awaiting Shawn. Created automatically for every map-drawn node — his ruling
 * 2026-09-09: all of them reach his card, he takes them one at a time.
 *
 * `nodeKey` points at a `pm_nodes` row while pending, and deliberately keeps pointing at
 * the now-deleted key afterwards: retirement removes the PM node but the ruling survives
 * to record what became of it, which is why `label` is snapshotted here rather than read
 * back through a join.
 */
export interface PmRuling {
  id: string;
  rulingRef: string;
  nodeKey: string;
  label: string;
  parentNodeKey: string | null;
  status: RulingStatus;
  intent: ConnectionIntent;
  submittedBy: string | null;
  submittedAt: string;
  resolvedAt: string | null;
  resolvedNote: string | null;
  /** The canonical key this card became. Set only by a confirmed retirement. */
  ruledIntoNodeKey: string | null;
}

/** Everything the PM layer knows about a set of node keys, in one batch. Never flattened with canonical data — see getPmLayer.ts. */
export interface PmLayer {
  nodes: PmNode[];
  items: PmItem[];
  notes: PmNote[];
  references: PmReference[];
  files: PmFile[];
  links: PmNodeLink[];
  states: PmNodeState[];
  rulings: PmRuling[];
}
