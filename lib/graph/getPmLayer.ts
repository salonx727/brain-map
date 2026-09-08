// Server-only. The ONLY file outside src/lib/pm/** allowed to import pmReader.ts,
// mirroring getCanonicalGraph.ts's own rule for the canonical layer — nothing under
// src/components/** imports from src/lib/pm/** directly. Read-only by construction:
// this module never imports pmWriter.ts or touches the service-role credential.

import { createClient } from "@supabase/supabase-js";
import { getAllPmNodeKeys, getDefaultLayout, getPmLayerForNodeKeys } from "@/lib/pm/pmReader";
import type { PmLayer, PmLayout, PmLayoutPosition } from "@/lib/types/pm";

const EMPTY_LAYER: PmLayer = { nodes: [], items: [], notes: [], references: [], files: [], links: [], states: [] };

function readOnlyClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;
  return createClient(supabaseUrl, anonKey);
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
 * The whole board: PM data for these canonical keys plus every PM node that exists,
 * however it is attached.
 *
 * getPmLayerForNodeKeys is scoped on purpose and stays that way — it answers "what does
 * the PM layer know about exactly these keys", which is what a detail panel wants. But an
 * independent card has no canonical parent, no canonical key of its own and possibly no
 * links, so that question excludes it by construction. Asking it for the map meant a card
 * created with ADD CARD was written, acknowledged, and then absent on the next reload —
 * the precise "it looked saved" failure this rebuild exists to eliminate. The map asks a
 * different question, so it passes the complete key set instead of widening the scoped one.
 */
export async function getWholeBoardPmLayer(canonicalNodeKeys: string[]): Promise<PmLayer> {
  const client = readOnlyClient();
  if (!client) return EMPTY_LAYER;
  const pmKeys = await getAllPmNodeKeys(client);
  const keys = [...new Set([...canonicalNodeKeys, ...pmKeys])];
  if (keys.length === 0) return EMPTY_LAYER;
  return getPmLayerForNodeKeys(client, keys);
}
