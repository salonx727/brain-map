// Read-only access to the PM layer. Safe to construct with the anon key — every table
// here has an RLS policy granting anon SELECT and denying everything else (see
// 0002_pm_layer.sql). Mirrors src/lib/canonical/supabaseReader.ts's split: reads live in
// their own module, separate from pmWriter.ts's service-role-only write path, so a
// future refactor can't accidentally pull a write credential into a read-only caller.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PmFile, PmItem, PmLayer, PmLayout, PmLayoutPosition, PmNode, PmNodeLink, PmNodeState, PmNote, PmPerson, PmReference } from "@/lib/types/pm";
import { rulingRow } from "@/lib/pm/rulingReader";
import { withRetry } from "@/lib/retry";

function personRow(r: { id: string; name: string; created_at: string }): PmPerson {
  return { id: r.id, name: r.name, createdAt: r.created_at };
}

function nodeRow(r: {
  node_key: string;
  display_ref: string;
  parent_node_key: string | null;
  label: string;
  kind: string;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}): PmNode {
  return {
    nodeKey: r.node_key,
    displayRef: r.display_ref,
    parentNodeKey: r.parent_node_key,
    label: r.label,
    kind: r.kind as PmNode["kind"],
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

function itemRow(r: {
  id: string;
  node_key: string | null;
  kind: string;
  title: string;
  detail: string | null;
  status: string;
  waiting_on: string | null;
  owner_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}): PmItem {
  return {
    id: r.id,
    nodeKey: r.node_key,
    kind: r.kind as PmItem["kind"],
    title: r.title,
    detail: r.detail,
    status: r.status as PmItem["status"],
    waitingOn: r.waiting_on,
    ownerId: r.owner_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

function noteRow(r: {
  id: string;
  node_key: string | null;
  kind: string;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}): PmNote {
  return {
    id: r.id,
    nodeKey: r.node_key,
    kind: r.kind as PmNote["kind"],
    body: r.body,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}

function referenceRow(r: { id: string; node_key: string; ref_type: string; label: string | null; url: string; created_by: string | null; created_at: string }): PmReference {
  return { id: r.id, nodeKey: r.node_key, refType: r.ref_type as PmReference["refType"], label: r.label, url: r.url, createdBy: r.created_by, createdAt: r.created_at };
}

function fileRow(r: { id: string; node_key: string | null; storage_path: string; file_name: string; content_type: string | null; size_bytes: number | null; slot_index: number | null; created_by: string | null; created_at: string }): PmFile {
  return {
    id: r.id,
    nodeKey: r.node_key,
    storagePath: r.storage_path,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    slotIndex: r.slot_index,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function layoutRow(r: { id: string; name: string; is_default: boolean; created_by: string | null; created_at: string }): PmLayout {
  return { id: r.id, name: r.name, isDefault: r.is_default, createdBy: r.created_by, createdAt: r.created_at };
}

function layoutPositionRow(r: { layout_id: string; node_key: string; x: number; y: number; color: string | null; updated_by: string | null; updated_at: string }): PmLayoutPosition {
  return { layoutId: r.layout_id, nodeKey: r.node_key, x: r.x, y: r.y, color: r.color, updatedBy: r.updated_by, updatedAt: r.updated_at };
}

function linkRow(r: { id: string; from_node_key: string; to_node_key: string; relation?: string | null; citation: string | null; created_by: string | null; created_at: string }): PmNodeLink {
  return {
    id: r.id,
    fromNodeKey: r.from_node_key,
    toNodeKey: r.to_node_key,
    relation: (r.relation ?? null) as PmNodeLink["relation"],
    citation: r.citation,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}

function nodeStateRow(r: { node_key: string; state: string; updated_by: string | null; updated_at: string }): PmNodeState {
  return { nodeKey: r.node_key, state: r.state as PmNodeState["state"], updatedBy: r.updated_by, updatedAt: r.updated_at };
}

/**
 * Everything the PM layer knows about this exact set of node keys, in one batch —
 * items/notes/references/files scoped to these keys, pm_nodes whose OWN key or PARENT
 * key is in the set (so a sub-node created under a canonical parent shows up), and links
 * touching any of these keys on either end. Returns empty arrays for a key with nothing
 * recorded — never throws for "no PM data yet," that's the normal case.
 *
 * A pm_node_link's endpoint can be a standalone PM node (parent_node_key null) — one with
 * no canonical parent and no canonical key of its own, so it's invisible to the two
 * queries above. That's a real, valid graph member the link already proves exists; a
 * second pass fetches exactly those missing endpoint ids by their real node_key and folds
 * them in, so the returned node set is always complete for whatever links come back. No
 * parent is invented for it and no relationship beyond the real link is added.
 */
/** Every PM node's key, for a caller that needs the whole board rather than a scoped subgraph — see getWholeBoardPmLayer. */
export async function getAllPmNodeKeys(client: SupabaseClient): Promise<string[]> {
  return withRetry(async () => {
    const { data, error } = await client.from("pm_nodes").select("node_key");
    if (error) throw new Error(`getAllPmNodeKeys: ${error.message}`);
    return (data ?? []).map((r) => r.node_key as string);
  });
}

export async function getPmLayerForNodeKeys(client: SupabaseClient, nodeKeys: string[]): Promise<PmLayer> {
  // Wrapped whole: this is the page's single most exposed read (up to three sequential
  // round trips, the first alone firing nine concurrent queries), and the confirmed
  // repeat-crash path even after the first retry pass (2026-09-13, Codeman) — a partial
  // retry of just one round trip isn't enough, so a transient failure anywhere in here
  // re-runs the whole read from scratch. Safe because every query inside is a read.
  return withRetry(async () => {
    if (nodeKeys.length === 0) {
      const { data, error } = await client.from("pm_people").select("*");
      if (error) throw new Error(`getPmLayerForNodeKeys: ${error.message}`);
      return { nodes: [], items: [], notes: [], references: [], files: [], links: [], states: [], rulings: [], people: (data ?? []).map(personRow) };
    }

    const [nodesA, nodesB, items, notes, references, files, linksA, linksB, people] = await Promise.all([
      client.from("pm_nodes").select("*").in("node_key", nodeKeys),
      client.from("pm_nodes").select("*").in("parent_node_key", nodeKeys),
      client.from("pm_items").select("*").in("node_key", nodeKeys),
      client.from("pm_notes").select("*").in("node_key", nodeKeys),
      client.from("pm_references").select("*").in("node_key", nodeKeys),
      client.from("pm_files").select("*").in("node_key", nodeKeys),
      client.from("pm_node_links").select("*").in("from_node_key", nodeKeys),
      client.from("pm_node_links").select("*").in("to_node_key", nodeKeys),
      // Unscoped by node key on purpose — the whole assignee directory is two rows
      // (Shawn, Codeman) today, so every caller of this function gets it for free rather
      // than each one having to ask for it separately.
      client.from("pm_people").select("*"),
    ]);

    for (const r of [nodesA, nodesB, items, notes, references, files, linksA, linksB, people]) {
      if (r.error) throw new Error(`getPmLayerForNodeKeys: ${r.error.message}`);
    }

    const nodeByKey = new Map<string, PmNode>();
    for (const row of [...(nodesA.data ?? []), ...(nodesB.data ?? [])]) nodeByKey.set(row.node_key, nodeRow(row));
    const linkById = new Map<string, PmNodeLink>();
    for (const row of [...(linksA.data ?? []), ...(linksB.data ?? [])]) linkById.set(row.id, linkRow(row));

    const knownKeys = new Set([...nodeKeys, ...nodeByKey.keys()]);
    const missingEndpointKeys = new Set<string>();
    for (const link of linkById.values()) {
      if (!knownKeys.has(link.fromNodeKey)) missingEndpointKeys.add(link.fromNodeKey);
      if (!knownKeys.has(link.toNodeKey)) missingEndpointKeys.add(link.toNodeKey);
    }
    if (missingEndpointKeys.size > 0) {
      const { data, error } = await client.from("pm_nodes").select("*").in("node_key", [...missingEndpointKeys]);
      if (error) throw new Error(`getPmLayerForNodeKeys: ${error.message}`);
      for (const row of data ?? []) nodeByKey.set(row.node_key, nodeRow(row));
    }

    // Scoped to the complete final key set (original + every PM node discovered above,
    // including a standalone link endpoint) — every node this layer can possibly render is
    // in here, so no node's real work-state is ever silently missed.
    const allKeys = [...new Set([...nodeKeys, ...nodeByKey.keys()])];
    const [{ data: stateRows, error: stateError }, { data: rulingRows, error: rulingError }] = await Promise.all([
      client.from("pm_node_state").select("*").in("node_key", allKeys),
      // Every ruling touching this key set, not just the pending ones — a card whose ruling
      // was rejected still needs to read as rejected rather than as never submitted.
      client.from("pm_rulings").select("*").in("node_key", allKeys),
    ]);
    if (stateError) throw new Error(`getPmLayerForNodeKeys: ${stateError.message}`);
    if (rulingError) throw new Error(`getPmLayerForNodeKeys: ${rulingError.message}`);

    return {
      nodes: [...nodeByKey.values()],
      states: (stateRows ?? []).map(nodeStateRow),
      rulings: (rulingRows ?? []).map(rulingRow),
      items: (items.data ?? []).map(itemRow),
      notes: (notes.data ?? []).map(noteRow),
      references: (references.data ?? []).map(referenceRow),
      files: (files.data ?? []).map(fileRow),
      links: [...linkById.values()],
      people: (people.data ?? []).map(personRow),
    };
  });
}

/** Every to-do across every node, one place — a filtered query, not a separate table (per instruction: no new table if a query answers it). */
export async function getMasterTodoView(client: SupabaseClient, opts?: { ownerId?: string; status?: PmItem["status"] }): Promise<PmItem[]> {
  let query = client.from("pm_items").select("*").eq("kind", "todo").order("created_at", { ascending: false });
  if (opts?.ownerId) query = query.eq("owner_id", opts.ownerId);
  if (opts?.status) query = query.eq("status", opts.status);
  const { data, error } = await query;
  if (error) throw new Error(`getMasterTodoView: ${error.message}`);
  return (data ?? []).map(itemRow);
}

/** One card's own pm_items — the list the surface re-reads after a write, so TO DO is whatever Supabase holds, not a leftover optimistic row. */
export async function getItemsForNodeKey(client: SupabaseClient, nodeKey: string): Promise<PmItem[]> {
  const { data, error } = await client.from("pm_items").select("*").eq("node_key", nodeKey).order("created_at", { ascending: true });
  if (error) throw new Error(`getItemsForNodeKey: ${error.message}`);
  return (data ?? []).map(itemRow);
}

/** The UNSORTED inbox — files dropped with no node assignment yet. */
export async function getUnsortedFiles(client: SupabaseClient): Promise<PmFile[]> {
  const { data, error } = await client.from("pm_files").select("*").is("node_key", null).order("created_at", { ascending: false });
  if (error) throw new Error(`getUnsortedFiles: ${error.message}`);
  return (data ?? []).map(fileRow);
}

/** The single is_default layout plus its positions, or null if none has been seeded yet (falls back to GraphCanvas's computed layout). */
export async function getDefaultLayout(client: SupabaseClient): Promise<{ layout: PmLayout; positions: PmLayoutPosition[] } | null> {
  return withRetry(async () => {
    const { data: layouts, error: layoutError } = await client.from("pm_layouts").select("*").eq("is_default", true).limit(1);
    if (layoutError) throw new Error(`getDefaultLayout: ${layoutError.message}`);
    const layout = layouts?.[0];
    if (!layout) return null;

    const { data: positions, error: positionsError } = await client.from("pm_layout_positions").select("*").eq("layout_id", layout.id);
    if (positionsError) throw new Error(`getDefaultLayout: ${positionsError.message}`);

    return { layout: layoutRow(layout), positions: (positions ?? []).map(layoutPositionRow) };
  });
}

export async function listPeople(client: SupabaseClient): Promise<PmPerson[]> {
  const { data, error } = await client.from("pm_people").select("*").order("name");
  if (error) throw new Error(`listPeople: ${error.message}`);
  return (data ?? []).map(personRow);
}
