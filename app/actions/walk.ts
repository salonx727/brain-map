"use server";

// Read-only surface for WALK — see lib/walk/walkReader.ts's own header for why there is no
// write action here. Thin wrapper, same split as pm.ts: the client construction is the
// only thing this file does.

import { createPmServiceClient } from "@/lib/pm/serviceClient";
import { getWalkGraphForNode } from "@/lib/walk/walkReader";
import { signWalkImageUrl } from "@/lib/walk/walkStorage";
import type { WalkGraph } from "@/lib/walk/types";

export type WalkGraphWithUrls = WalkGraph & {
  /** imageVersion id → a fresh signed URL, one entry per version that has an image_link. Never persisted past this response. */
  signedUrls: Record<string, string>;
};

/** Empty graph, empty signedUrls (never an error) for a node with nothing mapped — ACCEPTANCE.md #25. */
export async function getWalkForNodeAction(nodeId: string): Promise<WalkGraphWithUrls> {
  const client = createPmServiceClient();
  const graph = await getWalkGraphForNode(client, nodeId);

  const signedUrls: Record<string, string> = {};
  await Promise.all(
    graph.imageVersions
      .filter((v) => v.imageLink)
      .map(async (v) => {
        try {
          signedUrls[v.id] = await signWalkImageUrl(client, v.imageLink as string);
        } catch {
          // A row pointing at a path Storage no longer has (deleted out from under it) is
          // "no image" to the viewer, the same as image_link being null — not a thrown
          // error for the whole panel.
        }
      }),
  );

  return { ...graph, signedUrls };
}
