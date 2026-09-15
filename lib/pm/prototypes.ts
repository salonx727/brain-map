// An engine's UI prototype history — read and write, both against Supabase Storage
// directly. No table: see 0014_prototype_bucket.sql's own comment for why. "Latest" is
// always max(parsed version) at read time, computed here and nowhere else, so there is
// never a second value that could disagree with what Storage actually holds.

import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "prototypes";
const VERSION_RE = /^v(\d+)\.html$/;

export interface PrototypeVersion {
  engineKey: string;
  version: number;
  path: string;
  figmaUrl: string | null;
  updatedAt: string | null;
}

function versionFromName(name: string): number | null {
  const m = VERSION_RE.exec(name);
  return m ? Number(m[1]) : null;
}

/**
 * Every version on file for one engine, newest first. Empty array (never an error) for
 * an engine with nothing uploaded yet — "no prototype" is a normal state, not a failure.
 *
 * Two calls per version, not one: confirmed live against this project's Storage API —
 * `list()`'s own metadata field carries only the standard file attributes (size,
 * mimetype, etag...); a custom key set at upload (the Figma URL) is real and persisted,
 * but only `info()` returns it. Fetched in parallel, not a real cost at this app's scale
 * (single-digit versions per engine).
 */
export async function listPrototypeVersions(client: SupabaseClient, engineKey: string): Promise<PrototypeVersion[]> {
  const { data, error } = await client.storage.from(BUCKET).list(engineKey, { sortBy: { column: "name", order: "desc" } });
  if (error) throw new Error(`listPrototypeVersions: ${error.message}`);

  const matched = (data ?? [])
    .map((entry) => ({ entry, version: versionFromName(entry.name) }))
    .filter((x): x is { entry: (typeof data)[number]; version: number } => x.version !== null); // a stray non-conforming file in the folder is skipped, never guessed at

  const out = await Promise.all(
    matched.map(async ({ entry, version }) => {
      const path = `${engineKey}/${entry.name}`;
      const { data: info } = await client.storage.from(BUCKET).info(path);
      // Storage's own info() has been observed to normalize a custom metadata key to
      // camelCase regardless of how it was sent — both read here so an older upload
      // (or a future client library change) can't silently stop surfacing its link.
      const meta = info?.metadata as Record<string, unknown> | undefined;
      const figmaUrl = typeof meta?.figmaUrl === "string" ? meta.figmaUrl : typeof meta?.figma_url === "string" ? meta.figma_url : null;
      return { engineKey, version, path, figmaUrl, updatedAt: entry.updated_at ?? null };
    }),
  );
  return out.sort((a, b) => b.version - a.version);
}

/** The single latest version, or null if this engine has none yet. */
export async function getLatestPrototypeVersion(client: SupabaseClient, engineKey: string): Promise<PrototypeVersion | null> {
  const versions = await listPrototypeVersions(client, engineKey);
  return versions[0] ?? null;
}

/**
 * Uploads a new version — always the next integer after whatever is already there, never
 * a number the caller supplies. This is what makes "just drop the file in" true: nobody
 * has to know, remember, or agree on what the last version was.
 */
export async function uploadPrototypeVersion(
  client: SupabaseClient,
  input: { engineKey: string; bytes: ArrayBuffer | Blob | Buffer; contentType?: string; figmaUrl?: string | null },
): Promise<PrototypeVersion> {
  const existing = await listPrototypeVersions(client, input.engineKey);
  const nextVersion = (existing[0]?.version ?? 0) + 1;
  const name = `v${nextVersion}.html`;
  const path = `${input.engineKey}/${name}`;

  const { error } = await client.storage.from(BUCKET).upload(path, input.bytes, {
    contentType: input.contentType ?? "text/html",
    metadata: input.figmaUrl ? { figmaUrl: input.figmaUrl } : undefined,
  });
  if (error) throw new Error(`uploadPrototypeVersion: ${error.message}`);

  return { engineKey: input.engineKey, version: nextVersion, path, figmaUrl: input.figmaUrl ?? null, updatedAt: new Date().toISOString() };
}

/** A short-lived link to view one version's HTML — never a permanent public URL, matching pm-files' own posture. */
export async function signPrototypeUrl(client: SupabaseClient, path: string, expiresInSeconds = 3600): Promise<string> {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(`signPrototypeUrl: ${error.message}`);
  return data.signedUrl;
}
