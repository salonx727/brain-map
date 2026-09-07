// Publishes a validated canonical graph to Supabase — the only code path allowed to call
// `publish_canonical_snapshot` (see supabase/migrations/0001_canonical_layer.sql). Runs
// locally (wherever COYOTE already lands), never inside Vercel/Next.js — the Next.js app
// only ever reads `canonical_sync_state`/`canonical_nodes`/`canonical_connections`, never
// writes them and never sees this module.
//
// Split deliberately into pure decision logic (computeSourceHash, decideSyncAction) and a
// thin Supabase-calling wrapper (publishSnapshot) so the decision logic is fully unit
// testable without a live Supabase project — there isn't one provisioned yet (see the
// implementation report's remaining-blockers section).

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalConnection, CanonicalNode } from "@/lib/types/canonicalNode";
import { validateCanonicalGraph, type ValidationResult } from "@/lib/canonical/validator";
import { buildFullDiagnostics } from "@/lib/coyote/diagnostics";
import type { ParseResult } from "@/lib/coyote/parser";

/** Matches every COYOTE package's own CHECKSUM.txt convention exactly — same algorithm, same encoding. */
export function computeSourceHash(rawText: string): string {
  return createHash("sha256").update(rawText, "utf-8").digest("hex");
}

export type SyncAction =
  | { kind: "no_op"; reason: string }
  | { kind: "publish"; reason: string }
  | { kind: "reject"; reason: string; details: string[] };

/**
 * Pure decision: given the candidate's hash/validation and the last known-good hash,
 * decide what to do — never touches Supabase. `currentHash` is `null` on a fresh
 * database (nothing published yet), which must publish, not no-op.
 */
export function decideSyncAction(
  candidateHash: string,
  currentHash: string | null,
  validation: ValidationResult,
  /**
   * Republish even though the source is byte-identical to what is already live.
   *
   * The hash covers the COYOTE text and nothing else, so a snapshot's identity says
   * nothing about the parser that produced it. When an extractor learns to read a field
   * it previously skipped, the source has not changed and this would no-op forever —
   * production keeps serving the old, thinner graph and reports success while doing it.
   * That is a silent drift, so the override is explicit and operator-driven rather than
   * automatic. Validation still runs: force skips the "nothing changed" check, never the
   * check that the result is publishable.
   */
  force = false,
): SyncAction {
  if (!validation.ok) {
    return { kind: "reject", reason: validation.reason, details: validation.details };
  }
  if (force && currentHash !== null && currentHash === candidateHash) {
    return { kind: "publish", reason: "Source unchanged, but a republish was explicitly requested — parser output may differ." };
  }
  if (currentHash !== null && currentHash === candidateHash) {
    return { kind: "no_op", reason: "Candidate hash matches the already-published snapshot — nothing changed." };
  }
  return { kind: "publish", reason: currentHash === null ? "No snapshot published yet." : "Candidate hash differs from the published snapshot." };
}

export interface CanonicalSyncStateRow {
  active_snapshot_id: string | null;
  source_hash: string | null;
  source_filename: string | null;
  register_entry_count: number | null;
  synced_at: string | null;
  sync_status: "ok" | "failed" | "never_run";
  last_error: string | null;
  attempted_at: string | null;
}

export type PublishResult =
  | { kind: "no_op" | "published"; snapshotId: string }
  | { kind: "rejected"; reason: string; details: string[] };

/** Exported so supabaseReader.test.ts can assert a real round-trip against nodeRowToCanonicalNode, not two independently-typed mirrors that happen to agree today. */
export function toNodeRow(node: CanonicalNode) {
  // canon_refs and field_states are stored as opaque JSONB — the DB never interprets
  // their shape, only the TS types on read do. Keeps the migration stable across future
  // additions to FieldValue/CanonRef without a schema change.
  const { nodeKey, kind, label, canonRefs, ...rest } = node;
  return { node_key: nodeKey, kind, label, canon_refs: canonRefs, field_states: rest };
}

/** Exported so supabaseReader.test.ts can assert a real round-trip against connectionRowToCanonicalConnection. */
export function toConnectionRow(conn: CanonicalConnection) {
  return {
    from_node_key: conn.fromNodeKey,
    to_node_key: conn.toNodeKey,
    edge_type: conn.type,
    directed: conn.directed,
    backward: conn.backward,
    declaring_citation: conn.declaringCitation,
  };
}

/**
 * The one function allowed to write to canonical_* tables. `client` must be constructed
 * with the dedicated sync service role (never the PM-write role, never the anon key) —
 * see the RISKS section of the sync-architecture review for why that separation matters
 * even with RLS configured correctly.
 */
export async function publishSnapshot(
  client: SupabaseClient,
  rawSourceText: string,
  sourceFilename: string,
  registerEntryCount: number,
  parseResult: Pick<ParseResult, "nodes" | "connections" | "diagnostics" | "blockers" | "openQuestions">,
  /** See decideSyncAction's `force` parameter for when this is the right thing to do. */
  force = false,
): Promise<PublishResult> {
  const candidateHash = computeSourceHash(rawSourceText);
  // Full diagnostics (parser diagnostics + unattributed blocker/open-question
  // conversions) computed once, here, so validation and what actually gets published
  // can never drift apart — see diagnostics.ts's header comment.
  const fullDiagnostics = buildFullDiagnostics(parseResult);
  const validation = validateCanonicalGraph(parseResult.nodes, parseResult.connections, fullDiagnostics);

  const { data: stateRows, error: stateError } = await client.from("canonical_sync_state").select("source_hash, active_snapshot_id").eq("id", true).limit(1);
  if (stateError) {
    await recordFailure(client, `Could not read canonical_sync_state: ${stateError.message}`);
    return { kind: "rejected", reason: "Could not read current sync state.", details: [stateError.message] };
  }
  const current = stateRows?.[0] as { source_hash: string | null; active_snapshot_id: string | null } | undefined;
  const currentHash = current?.source_hash ?? null;

  const action = decideSyncAction(candidateHash, currentHash, validation, force);

  if (action.kind === "reject") {
    await recordFailure(client, `${action.reason} :: ${action.details.join(" | ")}`);
    return { kind: "rejected", reason: action.reason, details: action.details };
  }
  if (action.kind === "no_op") {
    // Best-effort only — the SQL function's own no-op branch returns before touching
    // canonical_sync_state at all (by design: a no-op is not a new sync event, so
    // synced_at must not move). But that means a stale sync_status='failed' from an
    // earlier rejected attempt survives a later legitimate no-op unless something clears
    // it, which would misreport the current (correct, unchanged) active snapshot as
    // broken. Clearing it here, not in SQL, so this stays cosmetic — never on the
    // critical atomicity path the SQL function owns.
    await client.from("canonical_sync_state").update({ sync_status: "ok", last_error: null }).eq("id", true).eq("sync_status", "failed");
    return { kind: "no_op", snapshotId: current?.active_snapshot_id ?? "" };
  }

  const { data: newId, error: publishError } = await client.rpc("publish_canonical_snapshot", {
    p_source_hash: candidateHash,
    p_source_filename: sourceFilename,
    p_register_entry_count: registerEntryCount,
    p_nodes: parseResult.nodes.map(toNodeRow),
    p_connections: parseResult.connections.map(toConnectionRow),
    p_diagnostics: fullDiagnostics,
    // The database enforces its own hash idempotency independently of decideSyncAction —
    // deliberately, since atomicity and idempotency are the two things it will not trust
    // a caller for. Forcing therefore has to be told to both, or the TS decision to
    // publish is silently overruled and the RPC returns the old snapshot id as if it had
    // succeeded. See 0007_publish_force_flag.sql.
    p_force: force,
  });

  if (publishError) {
    await recordFailure(client, `publish_canonical_snapshot RPC failed: ${publishError.message}`);
    return { kind: "rejected", reason: "Publish RPC failed — previous snapshot remains active.", details: [publishError.message] };
  }

  return { kind: "published", snapshotId: newId as string };
}

async function recordFailure(client: SupabaseClient, message: string): Promise<void> {
  // Best-effort — if this itself fails, the caller's own rejection is still the source of
  // truth for this run; canonical_sync_state.last_error is a convenience for Gaelan's
  // alert, not the only record of what happened.
  try {
    await client.rpc("record_sync_failure", { p_error: message });
  } catch {
    // Swallowed deliberately — see comment above.
  }
}
