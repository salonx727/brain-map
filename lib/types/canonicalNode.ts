// Shared types for the server-only COYOTE resolver/parser (Phase 2+).
// Modules and Stages are intentionally absent — taxonomy is unruled (see nodeRegistry.ts).

export type NodeKind = "screen" | "engine" | "intake";

export type CanonRefType = "section" | "lock" | "qid";

export interface CanonRef {
  type: CanonRefType;
  value: string;
}

export interface SourceMeta {
  fileName: string;
  /** ISO timestamp — the resolved COYOTE file's own mtime, not resolution wall-clock time. */
  resolvedAt: string;
}

/**
 * Four explicit states, never a bare string/null. `disconnected` must never collapse into
 * `empty` — that collapse is the exact defect that made a prior build report severed
 * branches as healthy-empty.
 */
export type FieldValue =
  | { state: "present"; value: string }
  | { state: "empty" }
  | { state: "disconnected"; expectedAnchor: string }
  | { state: "unknown"; reason: string };

export type AttributionConfidence = "matched" | "unattributed";

export interface AttributedItem {
  text: string;
  status?: string;
  qId?: string;
  sourceSection: string;
  confidence: AttributionConfidence;
  nodeKey?: string; // present only when confidence === "matched"
}

interface BaseCanonicalNode {
  nodeKey: string;
  kind: NodeKind;
  label: string;
  canonRefs: CanonRef[];
  sourceMeta: SourceMeta;
}

export interface ScreenNode extends BaseCanonicalNode {
  kind: "screen";
  definition: FieldValue;
}

export interface EngineNode extends BaseCanonicalNode {
  kind: "engine";
  trigger: FieldValue;
  reads: FieldValue;
  writes: FieldValue;
  downstream: FieldValue;
  /**
   * §35.2's EMITS AT SESSION CLOSE table. Captured as a field rather than treated as a
   * mere boundary because its second column is a "·"-separated list of destination
   * engines — E01's entire outgoing fan-out lives here and nowhere else. E01 has no
   * DOWNSTREAM label at all, so before this was captured the busiest node in the
   * architecture parsed to zero outgoing edges.
   */
  emits: FieldValue;
  blockers: AttributedItem[];
  openQuestions: AttributedItem[];
}

/**
 * §39 BOOKING and §40 THE GATE — declared intake objects, not engines (no §35 spine
 * contract) and not screens (no §03 table row). LOCK-260901-369's `INT` class prefix
 * gives them a real, stable identity so an edge like `INT BOOKING → E01` (§35.2's own
 * TRIGGER) has somewhere to resolve to. Shares `ScreenNode`'s shape deliberately — a
 * plain box with one definition field, not a special case — so both kinds render
 * through the same DetailPanel sections and the same BrainCard on the canvas/list.
 */
export interface IntakeNode extends BaseCanonicalNode {
  kind: "intake";
  definition: FieldValue;
}

export type CanonicalNode = ScreenNode | EngineNode | IntakeNode;

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  nodeKey?: string;
  message: string;
  /**
   * Present only on the warning raised for a blocker or open question that names no
   * engine. The item travels alongside its message rather than only inside it, because
   * the map places these on an owner card (see lib/owners.ts) and reconstructing an item
   * by re-parsing English out of `message` would break the first time the wording moved.
   *
   * Stored in canonical_snapshots.diagnostics, which is jsonb and holds whatever shape
   * this type has — no migration was needed to start carrying it.
   */
  unattributed?: UnattributedItem;
}

export interface UnattributedItem {
  kind: "blocker" | "open question";
  text: string;
  sourceSection: string;
  qId?: string;
  status?: string;
}

/**
 * A data-flow edge between two canonical nodes, derived (never hand-typed) from an
 * engine's already-parsed READS/WRITES/DOWNSTREAM text. Composition edges (§42.5 — a
 * module containing an engine) are a different edge class and are not modeled here: no
 * module currently exists in canon (LOCK-260901-363 forbids pre-allocated slots), so
 * there is nothing yet to derive a composition edge from.
 *
 * `directed` is always `true` for this type — every §35 data-flow edge is directed, with
 * exactly one documented exception (`badge_awarded` → GHOST NOTES) that is a direction,
 * not an absence of one. The field is kept explicit rather than assumed so a future
 * composition-edge type can carry `directed: true` too (parent → child) without the two
 * classes silently looking identical.
 */
export interface CanonicalConnection {
  fromNodeKey: string;
  toNodeKey: string;
  type: "data_flow";
  directed: true;
  /**
   * True for exactly one edge today: `badge_awarded` (AFTERBURNER → GHOST NOTES),
   * §35.8's own "THE ONLY BACKWARD EDGE IN THE ARCHITECTURE" (LOCK-260809-051). Kept
   * distinguishable per that section's own claim — an unfalsifiable claim in canon is
   * worse than a missing one (§43.1: how it's stored is an implementation call; that it
   * must be checkable is canon, not preference).
   */
  backward: boolean;
  /** The exact §35 text asserting this edge exists. An edge with no citation is an assertion, not canon. */
  declaringCitation: string;
}
