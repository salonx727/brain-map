import { createPmServiceClient } from "./serviceClient";
import type { Model } from "@/lib/types";

const BUCKET = "pm-files";
const EXPIRES_SECONDS = 3600;

/**
 * Fills in a viewable link for every stored image the model refers to.
 *
 * The adapter deliberately leaves `data` null — it maps rows, and a row knows a storage
 * path, not a URL. But the bucket is private with no anon read policy, so a path alone
 * renders nothing: a UI slot with a real file behind it would come back from a reload
 * looking like an empty slot, which reads exactly like the upload never happened.
 *
 * Signed here, server-side, in one batch per page load rather than one call per image.
 * Non-image drops are left alone: they are listed by name and never displayed inline.
 */
export async function signModelFiles(model: Model): Promise<Model> {
  const client = createPmServiceClient();

  const paths = new Set<string>();
  for (const id of model.order) {
    for (const shot of model.nodes[id].screens) {
      if (shot?.storagePath) paths.add(shot.storagePath);
    }
    for (const drop of model.nodes[id].drops) {
      if (drop.storagePath && drop.type?.startsWith("image/")) paths.add(drop.storagePath);
    }
  }
  if (paths.size === 0) return model;

  const { data, error } = await client.storage.from(BUCKET).createSignedUrls([...paths], EXPIRES_SECONDS);
  // A signing failure is not worth blanking the map for — every other thing on the
  // surface is still true. The images stay unshown and the rest renders.
  if (error || !data) return model;

  const byPath = new Map<string, string>();
  for (const entry of data) {
    if (entry.path && entry.signedUrl) byPath.set(entry.path, entry.signedUrl);
  }

  for (const id of model.order) {
    const node = model.nodes[id];
    node.screens = node.screens.map((shot) =>
      shot?.storagePath ? { ...shot, data: byPath.get(shot.storagePath) ?? null } : shot,
    );
    node.drops = node.drops.map((drop) =>
      drop.storagePath && byPath.has(drop.storagePath)
        ? { ...drop, data: byPath.get(drop.storagePath) as string }
        : drop,
    );
  }

  return model;
}
