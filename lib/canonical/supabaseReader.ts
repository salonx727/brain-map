// Reads the published canonical snapshot from Supabase — the production counterpart to
// the local resolver/parser dev path. This is the ONLY file that may read canonical_*
// tables from inside the Next.js app, and it only ever reads — no insert/update/delete
// call exists here or anywhere else in this app; publishing is publisher.ts's job alone,
// and publisher.ts never runs inside Vercel (see its own header comment).
//
// Deliberately a separate module from publisher.ts even though both map the same row
// shapes: this file is safe to bundle into the Next.js app (anon key, read-only RLS
// policies), publisher.ts is not (sync-only service-role key, the only credential with
// write grants on these tables). Keeping them apart means a future refactor can't
// accidentally pull the write path into the client-facing bundle.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalConnection, CanonicalNode, Diagnostic } from "@/lib/types/canonicalNode";

export interface CanonicalNodeRow {
  node_key: string;
  kind: string;
  label: string;
  canon_refs: unknown;
  field_states: Record<string, unknown>;
}

export interface CanonicalConnectionRow {
  from_node_key: string;
  to_node_key: string;
  edge_type: string;
  directed: boolean;
  backward: boolean;
  evidence_class: string;
  declaring_citation: string;
}

/** Exact inverse of publisher.ts's toNodeRow — round-trips a published row back to the app's own CanonicalNode shape. */
export function nodeRowToCanonicalNode(row: CanonicalNodeRow): CanonicalNode {
  return {
    nodeKey: row.node_key,
    kind: row.kind,
    label: row.label,
    canonRefs: row.canon_refs,
    ...row.field_states,
  } as CanonicalNode;
}

/** Exact inverse of publisher.ts's toConnectionRow. */
export function connectionRowToCanonicalConnection(row: CanonicalConnectionRow): CanonicalConnection {
  return {
    fromNodeKey: row.from_node_key,
    toNodeKey: row.to_node_key,
    type: row.edge_type,
    directed: row.directed,
    backward: row.backward,
    // A snapshot published before 0010 has no evidence column at all. Reading it as
    // declared matches what the column's own default backfilled those rows to, so an old
    // snapshot and a re-read of it never disagree.
    evidenceClass: row.evidence_class === "inferred" ? "inferred" : "declared",
    declaringCitation: row.declaring_citation,
  } as CanonicalConnection;
}

export interface SupabaseCanonicalGraph {
  nodes: CanonicalNode[];
  connections: CanonicalConnection[];
  diagnostics: Diagnostic[];
  sourceError?: string;
}

/**
 * `client` must be constructed with the anon (read-only, RLS-gated) key — never the sync
 * service-role key, which has no business inside a Next.js request handler. Follows
 * `canonical_sync_state.active_snapshot_id` exactly as the sync-architecture review
 * specifies: readers never scan `canonical_snapshots` directly, only the one pointer.
 */
export async function fetchCanonicalGraphFromSupabase(client: SupabaseClient): Promise<SupabaseCanonicalGraph> {
  const { data: stateRows, error: stateError } = await client
    .from("canonical_sync_state")
    .select("active_snapshot_id")
    .eq("id", true)
    .limit(1);

  if (stateError) {
    return { nodes: [], connections: [], diagnostics: [], sourceError: `Could not read canonical_sync_state: ${stateError.message}` };
  }

  const activeSnapshotId = (stateRows?.[0] as { active_snapshot_id: string | null } | undefined)?.active_snapshot_id;
  if (!activeSnapshotId) {
    return { nodes: [], connections: [], diagnostics: [], sourceError: "No canonical snapshot has been published yet." };
  }

  const [snapshotResult, nodesResult, connectionsResult] = await Promise.all([
    client.from("canonical_snapshots").select("diagnostics").eq("id", activeSnapshotId).limit(1),
    client.from("canonical_nodes").select("node_key, kind, label, canon_refs, field_states").eq("snapshot_id", activeSnapshotId),
    client.from("canonical_connections").select("from_node_key, to_node_key, edge_type, directed, backward, evidence_class, declaring_citation").eq("snapshot_id", activeSnapshotId),
  ]);

  if (snapshotResult.error) {
    return { nodes: [], connections: [], diagnostics: [], sourceError: `Could not read canonical_snapshots: ${snapshotResult.error.message}` };
  }
  if (nodesResult.error) {
    return { nodes: [], connections: [], diagnostics: [], sourceError: `Could not read canonical_nodes: ${nodesResult.error.message}` };
  }
  if (connectionsResult.error) {
    return { nodes: [], connections: [], diagnostics: [], sourceError: `Could not read canonical_connections: ${connectionsResult.error.message}` };
  }

  const diagnostics = ((snapshotResult.data?.[0] as { diagnostics: Diagnostic[] } | undefined)?.diagnostics ?? []) as Diagnostic[];
  const nodes = (nodesResult.data ?? []).map((row) => nodeRowToCanonicalNode(row as CanonicalNodeRow));
  const connections = (connectionsResult.data ?? []).map((row) => connectionRowToCanonicalConnection(row as CanonicalConnectionRow));

  return { nodes, connections, diagnostics };
}
