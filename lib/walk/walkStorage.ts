// WALK images live in the existing pm-files bucket (already private, already the one
// bucket every signed-URL helper in this app points at) under a walk/ prefix — Salman,
// 2026-09-16: a dedicated bucket buys nothing the prefix doesn't already give, and reusing
// pm-files means no new bucket to provision. image_link in the DB is this path, never a
// URL; a signed URL is minted fresh per request and never persisted (see 0016_walk.sql).

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "pm-files";

/** walk/{node_id}/{screen_id}/{version_id}.png — exactly Salman's spec, 2026-09-16. */
export function walkImagePath(nodeId: string, screenId: string, versionId: string): string {
  return `walk/${nodeId}/${screenId}/${versionId}.png`;
}

export async function signWalkImageUrl(client: SupabaseClient, path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(`signWalkImageUrl: ${error.message}`);
  return data.signedUrl;
}
