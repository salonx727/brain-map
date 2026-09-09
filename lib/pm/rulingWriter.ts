// Every write to the ruling queue. Service-role credential only, same boundary and same
// reasoning as pmWriter.ts — pm_rulings denies anon everything but SELECT (0009).
//
// What this module deliberately CANNOT do: write COYOTE, write any canonical_* table, or
// mark a ruling ruled on its own. A ruling becomes canon only when Shawn writes it into
// COYOTE himself and the sync publishes it; retirePmNodeIntoCanonical runs afterwards, on
// a human's confirmation, and its job is to remove the now-duplicate PM row — not to
// promote anything.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionIntent, PmRuling } from "@/lib/types/pm";
import { rulingRow } from "@/lib/pm/rulingReader";

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${label}: insert/update returned no row`);
  return result.data;
}

/**
 * Opens a ruling for a node. Called by createPmNode for every card the map creates —
 * Shawn's ruling 2026-09-09: all of them reach his list, he takes them one at a time. The
 * unique partial index on (node_key) where status = 'pending' means a second call for the
 * same node cannot double it up in the queue.
 */
export async function createRuling(
  client: SupabaseClient,
  input: { nodeKey: string; label: string; parentNodeKey?: string | null; intent?: Partial<ConnectionIntent>; submittedBy?: string | null },
): Promise<PmRuling> {
  const { data, error } = await client
    .from("pm_rulings")
    .insert({
      node_key: input.nodeKey,
      label: input.label,
      parent_node_key: input.parentNodeKey ?? null,
      intent_downstream: input.intent?.downstream ?? null,
      intent_reads: input.intent?.reads ?? null,
      intent_emits: input.intent?.emits ?? null,
      intent_trigger: input.intent?.trigger ?? null,
      submitted_by: input.submittedBy ?? null,
    })
    .select()
    .single();
  return rulingRow(unwrap({ data, error }, "createRuling"));
}

/** Edits what a pending card is proposing about its connections. Scoped to pending on purpose — a ruled card's intent is history, and rewriting it would misrepresent what Shawn actually ruled on. */
export async function updateRulingIntent(client: SupabaseClient, nodeKey: string, intent: Partial<ConnectionIntent>): Promise<PmRuling> {
  const { data, error } = await client
    .from("pm_rulings")
    .update({
      intent_downstream: intent.downstream ?? null,
      intent_reads: intent.reads ?? null,
      intent_emits: intent.emits ?? null,
      intent_trigger: intent.trigger ?? null,
    })
    .eq("node_key", nodeKey)
    .eq("status", "pending")
    .select()
    .single();
  return rulingRow(unwrap({ data, error }, "updateRulingIntent"));
}

/**
 * Shawn ruled no. The card stays exactly where it is — his instruction: it keeps living in
 * the PM layer, marked OUT OF SCOPE, and is removed by hand from the card itself if anyone
 * wants it gone. Nothing is deleted here; a rejection that quietly destroyed a card's
 * to-dos and files would make the queue something people route around.
 */
export async function rejectRuling(client: SupabaseClient, nodeKey: string, note?: string | null): Promise<PmRuling> {
  const { data, error } = await client
    .from("pm_rulings")
    .update({ status: "rejected", resolved_at: new Date().toISOString(), resolved_note: note ?? null })
    .eq("node_key", nodeKey)
    .eq("status", "pending")
    .select()
    .single();
  const ruling = rulingRow(unwrap({ data, error }, "rejectRuling"));

  const { error: stateError } = await client
    .from("pm_node_state")
    .upsert({ node_key: nodeKey, state: "OUT_OF_SCOPE", updated_at: new Date().toISOString() }, { onConflict: "node_key" });
  if (stateError) throw new Error(`rejectRuling: ${stateError.message}`);

  return ruling;
}

/**
 * The card someone drew is now a canonical node, confirmed by a human against the
 * reconcile list. Fold the PM row into it.
 *
 * All seven tables move inside one Postgres transaction — see the function's own header in
 * 0009_ruling_layer.sql for why this cannot be a sequence of client-side calls.
 */
export async function retirePmNodeIntoCanonical(client: SupabaseClient, pmNodeKey: string, canonicalNodeKey: string): Promise<void> {
  const { error } = await client.rpc("retire_pm_node_into_canonical", {
    p_pm_key: pmNodeKey,
    p_canonical_key: canonicalNodeKey,
  });
  if (error) throw new Error(`retirePmNodeIntoCanonical: ${error.message}`);
}
