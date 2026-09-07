// Server-only. The ONLY file outside src/lib/pm/** allowed to import pmReader.ts,
// mirroring getCanonicalGraph.ts's own rule for the canonical layer — nothing under
// src/components/** imports from src/lib/pm/** directly. Read-only by construction:
// this module never imports pmWriter.ts or touches the service-role credential.

import { createClient } from "@supabase/supabase-js";
import { getDefaultLayout, getPmLayerForNodeKeys } from "@/lib/pm/pmReader";
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
