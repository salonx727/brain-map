// Read-only access to the ruling queue. Safe with the anon key — pm_rulings grants anon
// SELECT and nothing else (0009_ruling_layer.sql), same posture as every other PM table.
// Kept separate from rulingWriter.ts for the same reason pmReader/pmWriter are separate:
// a read-only caller must not be able to reach a service-role credential by accident.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PmRuling, RulingStatus } from "@/lib/types/pm";
import type { CanonicalNode } from "@/lib/types/canonicalNode";

interface RulingRow {
  id: string;
  ruling_ref: string;
  node_key: string;
  label: string;
  parent_node_key: string | null;
  status: string;
  intent_downstream: string | null;
  intent_reads: string | null;
  intent_emits: string | null;
  intent_trigger: string | null;
  submitted_by: string | null;
  submitted_at: string;
  resolved_at: string | null;
  resolved_note: string | null;
  ruled_into_node_key: string | null;
}

export function rulingRow(r: RulingRow): PmRuling {
  return {
    id: r.id,
    rulingRef: r.ruling_ref,
    nodeKey: r.node_key,
    label: r.label,
    parentNodeKey: r.parent_node_key,
    status: r.status as RulingStatus,
    intent: {
      downstream: r.intent_downstream,
      reads: r.intent_reads,
      emits: r.intent_emits,
      trigger: r.intent_trigger,
    },
    submittedBy: r.submitted_by,
    submittedAt: r.submitted_at,
    resolvedAt: r.resolved_at,
    resolvedNote: r.resolved_note,
    ruledIntoNodeKey: r.ruled_into_node_key,
  };
}

/** The queue on Shawn's card — everything still awaiting his ruling, oldest first so the backlog reads as a line, not a stack. */
export async function getPendingRulings(client: SupabaseClient): Promise<PmRuling[]> {
  const { data, error } = await client
    .from("pm_rulings")
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(`getPendingRulings: ${error.message}`);
  return (data ?? []).map(rulingRow);
}

export async function getRulingsForNodeKeys(client: SupabaseClient, nodeKeys: string[]): Promise<PmRuling[]> {
  if (nodeKeys.length === 0) return [];
  const { data, error } = await client.from("pm_rulings").select("*").in("node_key", nodeKeys);
  if (error) throw new Error(`getRulingsForNodeKeys: ${error.message}`);
  return (data ?? []).map(rulingRow);
}

/**
 * Comparison key for "is this canonical arrival the card someone drew?" — case, spacing
 * and punctuation removed, because a label typed on a card and a label parsed out of §35
 * agree on the words and almost never on the formatting ("Spotlight card" vs
 * "E12 - SPOTLIGHT CARD"). Leading canonical id prefixes are stripped for the same reason.
 */
export function normalizeLabel(label: string): string {
  return label
    .toUpperCase()
    .replace(/^(E|S|INT)\s*\d+[\s\-–—:.]*/u, "")
    .replace(/[^A-Z0-9]+/gu, "");
}

export interface ReconcileCandidate {
  ruling: PmRuling;
  matches: { nodeKey: string; label: string }[];
}

/**
 * Pending rulings whose label matches a node in the published snapshot — the shortlist the
 * reconcile tray asks a human about.
 *
 * This SUGGESTS and never acts. Shawn rules in his own language and COYOTE carries no
 * map-generated identifier, so a label match is the only signal available, and a label
 * match is not proof: two cards can be named the same thing and mean different things.
 * Retiring the wrong card would delete real work, so the confirming tap is the mechanism,
 * not a formality. (Should a ruling ref ever start appearing in COYOTE, an exact-match
 * branch belongs here and those would retire without the tap — pm_rulings.ruling_ref is
 * already held for that.)
 */
export function findReconcileCandidates(pending: PmRuling[], canonicalNodes: CanonicalNode[]): ReconcileCandidate[] {
  const byLabel = new Map<string, { nodeKey: string; label: string }[]>();
  for (const node of canonicalNodes) {
    const key = normalizeLabel(node.label);
    if (!key) continue;
    const list = byLabel.get(key) ?? [];
    list.push({ nodeKey: node.nodeKey, label: node.label });
    byLabel.set(key, list);
  }

  const out: ReconcileCandidate[] = [];
  for (const ruling of pending) {
    const matches = byLabel.get(normalizeLabel(ruling.label));
    if (matches?.length) out.push({ ruling, matches });
  }
  return out;
}
