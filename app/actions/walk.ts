"use server";

// Read path plus the manual-upload write path added 2026-09-17 (Shawn's ruling — see
// lib/walk/walkWriter.ts's own header). Thin wrappers, same split as pm.ts: the logic lives
// in lib/walk/*, this file's only job is constructing the service-role client and never
// letting it leak past this boundary — a Client Component may call these directly (Next.js
// Server Actions) but never receives the credential itself.

import { revalidatePath } from "next/cache";
import { createPmServiceClient } from "@/lib/pm/serviceClient";
import { getWalkGraphForNode, listStagedImages } from "@/lib/walk/walkReader";
import { signWalkImageUrl } from "@/lib/walk/walkStorage";
import {
  branchFromScreen,
  createScreenAtEnd,
  discardStagedImage,
  hideScreen,
  insertScreenBetween,
  replaceScreenImage,
  stageImage,
  startWalkForNode,
} from "@/lib/walk/walkWriter";
import type { WalkGraph, WalkStagedImage } from "@/lib/walk/types";

export type WalkGraphWithUrls = WalkGraph & {
  /** imageVersion id → a fresh signed URL, one entry per version that has an image_link. Never persisted past this response. */
  signedUrls: Record<string, string>;
  /** Every uploaded file not yet placed into a flow — the staging tray, Shawn's spec 2026-09-17. */
  stagedImages: WalkStagedImage[];
  /** stagedImage id → a fresh signed URL, so the tray can show a thumbnail before anything is placed. */
  stagedUrls: Record<string, string>;
};

/** Empty graph, empty signedUrls (never an error) for a node with nothing mapped — ACCEPTANCE.md #25. */
export async function getWalkForNodeAction(nodeId: string): Promise<WalkGraphWithUrls> {
  const client = createPmServiceClient();
  const [graph, stagedImages] = await Promise.all([getWalkGraphForNode(client, nodeId), listStagedImages(client, nodeId)]);

  const signedUrls: Record<string, string> = {};
  const stagedUrls: Record<string, string> = {};
  await Promise.all([
    ...graph.imageVersions
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
    ...stagedImages.map(async (s) => {
      try {
        stagedUrls[s.id] = await signWalkImageUrl(client, s.storagePath);
      } catch {
        // Same posture as above — a tray thumbnail that can't sign shows as a plain file-name row.
      }
    }),
  ]);

  return { ...graph, signedUrls, stagedImages, stagedUrls };
}

/** Uploads a file straight into the tray, unassigned — never a Figma frame-picker (superseded task C, Shawn's ruling 2026-09-17). `duplicate` is a warning for the caller to surface, never a block. */
export async function stageWalkImageAction(formData: FormData): Promise<{ staged: WalkStagedImage; duplicate: boolean }> {
  const file = formData.get("file");
  if (!(file instanceof Blob)) throw new Error("stageWalkImageAction: no file provided");
  const nodeId = formData.get("nodeId") as string | null;
  if (!nodeId) throw new Error("stageWalkImageAction: nodeId is required");
  const fileName = file instanceof File ? file.name : "upload";

  const client = createPmServiceClient();
  const bytes = await file.arrayBuffer();
  const result = await stageImage(client, { nodeId, fileName, contentType: file.type || null, bytes });
  revalidatePath("/");
  return result;
}

export async function discardStagedImageAction(stagedId: string): Promise<void> {
  const client = createPmServiceClient();
  await discardStagedImage(client, stagedId);
  revalidatePath("/");
}

export async function replaceScreenImageAction(input: { nodeId: string; stagedId: string; screenId: string }) {
  const client = createPmServiceClient();
  const result = await replaceScreenImage(client, input);
  revalidatePath("/");
  return result;
}

export async function createScreenAtEndAction(input: { nodeId: string; flowId: string; stagedId: string; title?: string }) {
  const client = createPmServiceClient();
  const result = await createScreenAtEnd(client, input);
  revalidatePath("/");
  return result;
}

export async function insertScreenBetweenAction(input: {
  nodeId: string;
  flowId: string;
  stagedId: string;
  afterScreenId: string;
  beforeScreenId: string;
  title?: string;
}) {
  const client = createPmServiceClient();
  const result = await insertScreenBetween(client, input);
  revalidatePath("/");
  return result;
}

export async function branchFromScreenAction(input: { nodeId: string; flowId: string; stagedId: string; fromScreenId: string; title?: string }) {
  const client = createPmServiceClient();
  const result = await branchFromScreen(client, input);
  revalidatePath("/");
  return result;
}

/** Every node's own WALK — Shawn, 2026-09-17. Creates an empty flow (no screens yet) so the tray has something to attach the first upload to. */
export async function startWalkForNodeAction(input: { nodeId: string; title?: string }) {
  const client = createPmServiceClient();
  const result = await startWalkForNode(client, input);
  revalidatePath("/");
  return result;
}

/** Removes a screen from view — never the image versions underneath it. See walkWriter.hideScreen's own header. */
export async function hideScreenAction(input: { nodeId: string; screenId: string }) {
  const client = createPmServiceClient();
  await hideScreen(client, input);
  revalidatePath("/");
}
