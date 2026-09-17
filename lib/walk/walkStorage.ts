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

/**
 * walk/{node_id}/_staging/{staged_id}_{file_name} — never the final path. A tray image is
 * "unassigned" precisely because nothing in the flow points at this path; placing it always
 * copies the bytes to a real walkImagePath and deletes this object, so the staging path
 * never ends up referenced by a screen.
 */
export function walkStagingPath(nodeId: string, stagedId: string, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\-]/g, "_");
  return `walk/${nodeId}/_staging/${stagedId}_${safeName}`;
}

export async function signWalkImageUrl(client: SupabaseClient, path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(`signWalkImageUrl: ${error.message}`);
  return data.signedUrl;
}

export async function uploadWalkImage(
  client: SupabaseClient,
  path: string,
  bytes: Buffer | Blob | ArrayBuffer,
  contentType: string | null,
): Promise<void> {
  const { error } = await client.storage.from(BUCKET).upload(path, bytes, { contentType: contentType ?? undefined, upsert: false });
  if (error) throw new Error(`uploadWalkImage: ${error.message}`);
}

/** Placing a tray image never moves the original — it copies to the real path, so a failure after this point leaves the tray row intact rather than losing the file. */
export async function copyWalkImage(client: SupabaseClient, fromPath: string, toPath: string): Promise<void> {
  const { error } = await client.storage.from(BUCKET).copy(fromPath, toPath);
  if (error) throw new Error(`copyWalkImage: ${error.message}`);
}

export async function removeWalkImage(client: SupabaseClient, path: string): Promise<void> {
  const { error } = await client.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`removeWalkImage: ${error.message}`);
}
