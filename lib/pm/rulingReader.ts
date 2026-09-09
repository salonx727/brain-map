// Read-only access to the ruling queue. Safe with the anon key — pm_rulings grants anon
// SELECT and nothing else (0009_ruling_layer.sql), same posture as every other PM table.
// Kept separate from rulingWriter.ts for the same reason pmReader/pmWriter are separate:
// a read-only caller must not be able to reach a service-role credential by accident.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionRelation, PmRuling, RulingKind, RulingStatus } from "@/lib/types/pm";
import type { CanonicalConnection, CanonicalNode } from "@/lib/types/canonicalNode";

interface RulingRow {
  id: string;
  ruling_ref: string;
  kind?: string | null;
  node_key: string | null;
  label: string;
  parent_node_key: string | null;
  status: string;
  intent_downstream: string | null;
  intent_reads: string | null;
  intent_emits: string | null;
  intent_trigger: string | null;
  from_node_key?: string | null;
  to_node_key?: string | null;
  relation?: string | null;
  link_id?: string | null;
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
    // Defaulted rather than required: 0010's column carries the same default, so a row
    // read through a client that predates it is a node ruling by definition.
    kind: (r.kind ?? "node") as RulingKind,
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
    fromNodeKey: r.from_node_key ?? null,
    toNodeKey: r.to_node_key ?? null,
    relation: (r.relation ?? null) as ConnectionRelation | null,
    linkId: r.link_id ?? null,
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

/** Every ruling ever recorded — the sync's retirement pass needs the resolved ones too, to follow a card that already retired into canon. */
export async function getAllRulings(client: SupabaseClient): Promise<PmRuling[]> {
  const { data, error } = await client.from("pm_rulings").select("*").order("submitted_at", { ascending: true });
  if (error) throw new Error(`getAllRulings: ${error.message}`);
  return (data ?? []).map(rulingRow);
}

export async function getRulingsByIds(client: SupabaseClient, ids: string[]): Promise<PmRuling[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client.from("pm_rulings").select("*").in("id", ids);
  if (error) throw new Error(`getRulingsByIds: ${error.message}`);
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
    // Node rulings only. A link ruling names an edge, not a label, and matches exactly —
    // it must never be routed through this fuzzy path.
    if (ruling.kind !== "node") continue;
    const matches = byLabel.get(normalizeLabel(ruling.label));
    if (matches?.length) out.push({ ruling, matches });
  }
  return out;
}

/**
 * Pending link rulings whose edge the published snapshot now carries — the wires that
 * should retire, and unlike node rulings these need no confirming tap.
 *
 * The difference is evidential, not a difference in caution. A node ruling matches on a
 * label a human typed against a label Shawn wrote, and two cards can share a name and mean
 * different things. An edge is a pair of node keys and a direction: canon either holds
 * `engine:E10 → engine:E04` or it does not, and no second thing can be meant by it.
 *
 * `evidenceClass` is deliberately not consulted. Ruled 2026-09-09: for the question this
 * function asks — does canon already carry this connection — a declared edge and one
 * inferred from the target's READS do the same work, and a ruling whose edge is already
 * live either way is a duplicate whichever route canon took to it.
 *
 * A ruling drawn against a PM node that has since retired into canon is resolved through
 * `ruledIntoNodeKey` first, so the wire someone drew to a card still matches the edge canon
 * published for the node that card became.
 */
export function findCanonicalizedLinkRulings(
  pending: PmRuling[],
  canonicalConnections: CanonicalConnection[],
  /** Every ruling ever recorded, for resolving a retired PM key to the canonical key it became. */
  allRulings: PmRuling[] = [],
): PmRuling[] {
  const edges = new Set(canonicalConnections.map((c) => `${c.fromNodeKey}->${c.toNodeKey}`));

  const retiredInto = new Map<string, string>();
  for (const r of allRulings) {
    if (r.kind === "node" && r.nodeKey && r.ruledIntoNodeKey) retiredInto.set(r.nodeKey, r.ruledIntoNodeKey);
  }
  const resolve = (key: string): string => retiredInto.get(key) ?? key;

  return pending.filter((r) => {
    if (r.kind !== "link" || !r.fromNodeKey || !r.toNodeKey) return false;
    return edges.has(`${resolve(r.fromNodeKey)}->${resolve(r.toNodeKey)}`);
  });
}
