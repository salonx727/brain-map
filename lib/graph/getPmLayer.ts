// Server-only. The ONLY file outside src/lib/pm/** allowed to import pmReader.ts,
// mirroring getCanonicalGraph.ts's own rule for the canonical layer — nothing under
// src/components/** imports from src/lib/pm/** directly. Read-only by construction:
// this module never imports pmWriter.ts or touches the service-role credential.

import { createAnonClient } from "@/lib/supabase/client";
import { getDefaultLayout, getItemsForNodeKey, getPmLayerForNodeKeys, getWholePmLayer } from "@/lib/pm/pmReader";
import type { PmItem, PmLayer, PmLayout, PmLayoutPosition } from "@/lib/types/pm";

const EMPTY_LAYER: PmLayer = { nodes: [], items: [], notes: [], references: [], files: [], links: [], states: [], rulings: [], people: [], canonAssignments: [] };

function readOnlyClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;
  return createAnonClient(supabaseUrl, anonKey);
}

/**
 * The saved default layout's positions, or null if none has been seeded yet — the
 * canvas falls back to its own computed grid layout in that case (see GraphCanvas.tsx).
 * Never throws for "not configured"/"nothing seeded yet"; both are normal states.
 */
export async function getLayout(): Promise<{ layout: PmLayout; positions: PmLayoutPosition[] } | null> {
  const client = readOnlyClient();
  if (!client) return null;
  return getDefaultLayout(client);
}

/**
 * PM data for exactly these node keys, nested — never merged into canonical data. A
 * caller combines `{ canonical, pm }` at the component boundary only; see
 * DetailPanel.tsx for the one place that happens.
 *
 * Returns the empty layer (never throws) when Supabase isn't configured — local dev
 * with no PM backend still renders canonical data correctly, just with no PM section.
 */
export async function getPmLayer(nodeKeys: string[]): Promise<PmLayer> {
  const client = readOnlyClient();
  if (!client || nodeKeys.length === 0) return EMPTY_LAYER;
  return getPmLayerForNodeKeys(client, nodeKeys);
}

/**
 * The whole board. Unscoped on purpose — a card with no canonical parent and no
 * links is still a real card, and asking the scoped reader for "these keys" is
 * how ADD CARD used to vanish on reload. The key list argument is accepted so
 * older callers keep compiling; it is not used. Ten `.in(node_key, everyKey)`
 * filters is what Gateway-Timed-Out the live map on refresh.
 */
export async function getWholeBoardPmLayer(_canonicalNodeKeys?: string[]): Promise<PmLayer> {
  const client = readOnlyClient();
  if (!client) return EMPTY_LAYER;
  return getWholePmLayer(client);
}

/** One card's pm_items. Empty when Supabase is not configured. */
export async function getItemsForNode(nodeKey: string): Promise<PmItem[]> {
  const client = readOnlyClient();
  if (!client) return [];
  return getItemsForNodeKey(client, nodeKey);
}
