// Fail-closed validation for a parsed canonical graph, run immediately before publish.
//
// This is the one gate standing between "COYOTE changed" and "production data changed."
// Every check here returns a *reason to refuse*, never a reason to guess — matching the
// parser's own posture (degrade, report, never invent). A candidate that fails any check
// must never publish; the caller (publisher.ts) is responsible for leaving the previous
// snapshot active when this returns `ok: false`.

import type { CanonicalConnection, CanonicalNode, Diagnostic } from "@/lib/types/canonicalNode";

const KNOWN_NODE_KINDS = new Set(["screen", "engine", "intake"]);
const KNOWN_CONNECTION_TYPES = new Set(["data_flow"]);
const NODE_KEY_SHAPE = /^[a-z]+:[A-Za-z0-9_]+$/;

/**
 * A missing §-section produces one disconnected node per registry entry, not a global
 * diagnostic — so "is a whole section unreachable" is detected by this stable message
 * substring every extractor uses for that case (screens.ts, engines.ts, intake.ts),
 * rather than by counting disconnected fields, which conflates "one node's content gap"
 * with "the section doesn't exist at all." Two different severities; only the second
 * blocks publish.
 */
const SECTION_MISSING_MARKER = "not found in resolved COYOTE";

export interface ValidationOk {
  ok: true;
}

export interface ValidationFailure {
  ok: false;
  reason: string;
  /** Every problem found, not just the first — a candidate is rejected once, not iteratively. */
  details: string[];
}

export type ValidationResult = ValidationOk | ValidationFailure;

export function validateCanonicalGraph(
  nodes: CanonicalNode[],
  connections: CanonicalConnection[],
  diagnostics: Diagnostic[],
): ValidationResult {
  const problems: string[] = [];

  // 0. A candidate with zero nodes passes every check below trivially (no duplicates,
  //    no unknown kinds, no dangling edges) — confirmed live 2026-09-03 when an ad hoc
  //    empty submission published successfully and became the active snapshot. Fail
  //    closed instead: an empty result means the resolver/parser broke, not that COYOTE
  //    genuinely declared nothing. Matches the same posture as the whole-section-
  //    unreachable check below — degrade to "refuse," never to "ship nothing."
  if (nodes.length === 0) {
    problems.push("Candidate has zero nodes — refusing to publish an empty graph over a populated one.");
  }

  // 1. Node identity — shape and uniqueness. A malformed or duplicated node_key breaks
  //    every downstream join (PM data, edges, the UI itself keys off this string).
  const seen = new Set<string>();
  for (const node of nodes) {
    if (!NODE_KEY_SHAPE.test(node.nodeKey)) {
      problems.push(`Invalid node identity "${node.nodeKey}" — does not match the stable kind:REF shape.`);
    }
    if (seen.has(node.nodeKey)) {
      problems.push(`Duplicate node key "${node.nodeKey}".`);
    }
    seen.add(node.nodeKey);
  }

  // 2. Node class must be one this build knows how to store. Defense-in-depth: the TS
  //    union already guarantees this at parse time today, but a snapshot read back from
  //    Supabase as JSON at runtime has no such guarantee, and a future COYOTE class this
  //    validator doesn't recognize must be refused, never silently dropped.
  for (const node of nodes) {
    if (!KNOWN_NODE_KINDS.has(node.kind)) {
      problems.push(`Unknown node class "${node.kind}" on "${node.nodeKey}" — refusing to publish rather than dropping it.`);
    }
  }

  // 3. Every edge endpoint must resolve inside this same candidate's node set, and every
  //    edge must carry real metadata — an edge with no citation is an assertion, not canon.
  //    Duplicates and the backward-edge count are checked in the same pass since both
  //    need the full connections list, not a per-connection view.
  const connectionKeys = new Set<string>();
  let backwardCount = 0;
  for (const conn of connections) {
    const label = `"${conn.fromNodeKey ?? "?"}" -> "${conn.toNodeKey ?? "?"}"`;
    if (!conn.fromNodeKey || !conn.toNodeKey) {
      problems.push(`Connection ${label} is missing an endpoint.`);
      continue;
    }
    if (!seen.has(conn.fromNodeKey)) {
      problems.push(`Connection ${label} — "from" endpoint does not resolve to any node in this candidate.`);
    }
    if (!seen.has(conn.toNodeKey)) {
      problems.push(`Connection ${label} — "to" endpoint does not resolve to any node in this candidate.`);
    }
    if (!conn.declaringCitation || conn.declaringCitation.trim().length === 0) {
      problems.push(`Connection ${label} has no declaring citation.`);
    }
    if (!KNOWN_CONNECTION_TYPES.has(conn.type)) {
      problems.push(`Connection ${label} has unknown type "${conn.type}".`);
    }

    const connKey = `${conn.fromNodeKey}->${conn.toNodeKey}`;
    if (connectionKeys.has(connKey)) {
      problems.push(`Duplicate connection ${label} — canonical_connections' real primary key is (snapshot_id, from_node_key, to_node_key), so a second row here would silently collide or overwrite.`);
    }
    connectionKeys.add(connKey);

    if (conn.backward) backwardCount++;
  }

  // §35.8's "THE ONLY BACKWARD EDGE IN THE ARCHITECTURE" (LOCK-260809-051) is a checkable
  // claim only if the count is enforced, not just the column's existence — an unfalsifiable
  // claim in canon is worse than a missing one. Skipped entirely on an empty connections
  // list: check 0 above already refuses a zero-node candidate, and a candidate with real
  // nodes but zero connections is a parser/extractor failure the "whole section
  // unreachable" check (below) or a human reviewing diagnostics should catch, not this one.
  if (connections.length > 0 && backwardCount !== 1) {
    problems.push(`Expected exactly one connection marked backward (§35.8's documented exception) — found ${backwardCount}.`);
  }

  // 4. Whole-section unreachability blocks publish; a single node's content gap does not
  //    (Phase 3's UI already renders that gracefully via FieldStateChip — refusing to
  //    publish over it would make the pipeline stricter than the product it feeds).
  const sectionMissing = diagnostics.filter((d) => d.severity === "error" && d.message.includes(SECTION_MISSING_MARKER));
  if (sectionMissing.length > 0) {
    const sections = [...new Set(sectionMissing.map((d) => d.message))];
    problems.push(`Whole section(s) unreachable in this candidate: ${sections.join(" | ")}`);
  }

  if (problems.length > 0) {
    return { ok: false, reason: "Canonical graph failed validation — publish refused.", details: problems };
  }
  return { ok: true };
}
