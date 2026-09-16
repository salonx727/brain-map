"use server";

// Every PM write reachable from the UI goes through here. Thin wrappers over
// src/lib/pm/pmWriter.ts — the actual logic lives there so it stays unit-testable
// without Next.js; this file's only job is constructing the service-role client (via
// serviceClient.ts) and never letting it leak past this boundary. A Client Component
// may import and call these directly (Next.js Server Actions), but never gets the
// credential itself — that only ever exists in this process, server-side.

import { revalidatePath } from "next/cache";
import { createPmServiceClient } from "@/lib/pm/serviceClient";
import * as pmWriter from "@/lib/pm/pmWriter";
import { getItemsForNode } from "@/lib/graph/getPmLayer";
import { getRulingsByIds, getRulingsForNodeKeys } from "@/lib/pm/rulingReader";
import type { ConnectionIntent, ConnectionRelation, PmCanonAssignment, PmItem, PmNodeState, PmReference } from "@/lib/types/pm";
import type { OwnerKey } from "@/lib/owners";

export async function createItemAction(input: { kind: "todo" | "blocker"; title: string; nodeKey?: string | null; detail?: string; ownerId?: string | null; createdBy?: string | null }) {
  const client = createPmServiceClient();
  const item = await pmWriter.createItem(client, input);
  revalidatePath("/");
  return item;
}

export async function updateItemStatusAction(id: string, status: PmItem["status"], updatedBy?: string | null, waitingOn?: string | null) {
  const client = createPmServiceClient();
  const item = await pmWriter.updateItemStatus(client, id, status, updatedBy, waitingOn);
  revalidatePath("/");
  return item;
}

export async function updateItemTitleAction(id: string, title: string, updatedBy?: string | null) {
  const client = createPmServiceClient();
  const item = await pmWriter.updateItemTitle(client, id, title, updatedBy);
  revalidatePath("/");
  return item;
}

export async function deleteItemAction(id: string) {
  const client = createPmServiceClient();
  await pmWriter.deleteItem(client, id);
  revalidatePath("/");
}

/** Pushes an existing to-do/blocker to the other person — never a retype, never a duplicate. See pmWriter.reassignItem's own header comment. */
export async function reassignItemAction(itemId: string, toOwnerName: string, changedBy?: string | null) {
  const client = createPmServiceClient();
  const item = await pmWriter.reassignItem(client, { itemId, toOwnerName, changedBy });
  revalidatePath("/");
  return item;
}

/** Pushes a COYOTE line from one owner card to the other. Never writes COYOTE. */
export async function assignCanonBlockerAction(input: {
  fingerprint: string;
  assignedTo: OwnerKey;
  text: string;
  sourceSection: string;
  kind: PmCanonAssignment["kind"];
}) {
  const client = createPmServiceClient();
  const row = await pmWriter.assignCanonBlocker(client, input);
  revalidatePath("/");
  return row;
}

/** Re-read one card's pm_items. The list on screen is replaced with this, not merged with leftover optimistic rows. */
export async function listItemsForNodeAction(nodeKey: string) {
  return getItemsForNode(nodeKey);
}

export async function createNoteAction(input: { kind: "note" | "decision"; body: string; nodeKey?: string | null; createdBy?: string | null }) {
  const client = createPmServiceClient();
  const note = await pmWriter.createNote(client, input);
  revalidatePath("/");
  return note;
}

export async function addReferenceAction(input: { nodeKey: string; url: string; refType?: PmReference["refType"]; label?: string; createdBy?: string | null }) {
  const client = createPmServiceClient();
  const ref = await pmWriter.addReference(client, input);
  revalidatePath("/");
  return ref;
}

/**
 * Returns the ruling alongside the node because creating one always opens the other, and
 * the surface has to show both immediately — a card that appears without its AWAITING
 * RULING marker reads as already accepted into canon, which is the one thing it is not.
 * Read back rather than threaded through pmWriter so that module keeps returning a PmNode
 * and nothing else.
 */
export async function createPmNodeAction(input: { label: string; parentNodeKey?: string | null; kind?: "subnode" | "function"; createdBy?: string | null; intent?: Partial<ConnectionIntent> }) {
  const client = createPmServiceClient();
  const node = await pmWriter.createPmNode(client, input);
  const [ruling] = await getRulingsForNodeKeys(client, [node.nodeKey]);
  revalidatePath("/");
  return { node, ruling: ruling ?? null };
}

export async function renamePmNodeAction(nodeKey: string, label: string, updatedBy?: string | null) {
  const client = createPmServiceClient();
  const node = await pmWriter.renamePmNode(client, nodeKey, label, updatedBy);
  revalidatePath("/");
  return node;
}

/** Re-parents an existing PM node — picking an existing card as a sub, rather than typing a new one. Throws for a canonical node_key, same as renamePmNodeAction: see pmWriter.setPmNodeParent's own header comment. */
export async function setPmNodeParentAction(nodeKey: string, parentNodeKey: string | null, updatedBy?: string | null) {
  const client = createPmServiceClient();
  const node = await pmWriter.setPmNodeParent(client, nodeKey, parentNodeKey, updatedBy);
  revalidatePath("/");
  return node;
}

export async function createNodeLinkAction(input: { fromNodeKey: string; toNodeKey: string; citation?: string | null; createdBy?: string | null }) {
  const client = createPmServiceClient();
  const link = await pmWriter.createNodeLink(client, input);
  revalidatePath("/");
  return link;
}

/**
 * Draws a §35 wire and opens its ruling, returning both the ruling row and the link id so
 * the surface can show the pending wire and the queue entry without a reload.
 *
 * `label` is composed here rather than in the database because it is display text — the
 * one line Shawn reads in the queue — and it needs the cards' own labels, which the RPC
 * would have to join two tables it deliberately has no FK into to find.
 */
export async function proposeConnectionAction(input: { fromNodeKey: string; toNodeKey: string; relation: ConnectionRelation; label: string; createdBy?: string | null }) {
  const client = createPmServiceClient();
  const result = await pmWriter.proposeConnection(client, input);
  const [ruling] = await getRulingsByIds(client, [result.rulingId]);
  revalidatePath("/");
  return { ruling: ruling ?? null, linkId: result.linkId, existing: result.existing };
}

export async function deleteNodeLinkAction(id: string) {
  const client = createPmServiceClient();
  await pmWriter.deleteNodeLink(client, id);
  revalidatePath("/");
}

export async function updateNodeLinkAction(
  id: string,
  patch: { fromNodeKey?: string; toNodeKey?: string; citation?: string | null },
) {
  const client = createPmServiceClient();
  const link = await pmWriter.updateNodeLink(client, id, patch);
  revalidatePath("/");
  return link;
}

export async function upsertLayoutPositionAction(input: { layoutId: string; nodeKey: string; x: number; y: number; color?: string | null; updatedBy?: string | null }) {
  const client = createPmServiceClient();
  const position = await pmWriter.upsertLayoutPosition(client, input);
  // This used to skip revalidation, on the reasoning that the canvas already holds the
  // position locally and a drag is the most frequent write here by a wide margin. That
  // held while the page rendered per request — the next refresh read the new position
  // from Supabase either way. It stopped holding when the surface moved behind the CDN:
  // the row is saved, but a refresh would serve the cached page and the card would snap
  // back to where it was, for up to 30 seconds, looking exactly like the drag was lost.
  //
  // Cheap enough to do here: this only marks the cached page stale. It fires once when the
  // finger lifts, never per frame, and nothing regenerates until somebody asks for the
  // page again.
  revalidatePath("/");
  return position;
}

export async function assignFileToNodeAction(fileId: string, nodeKey: string | null) {
  const client = createPmServiceClient();
  const file = await pmWriter.assignFileToNode(client, fileId, nodeKey);
  revalidatePath("/");
  return file;
}

export async function getSignedFileUrlAction(storagePath: string) {
  const client = createPmServiceClient();
  return pmWriter.getSignedFileUrl(client, storagePath);
}

export async function createPersonAction(name: string) {
  const client = createPmServiceClient();
  const person = await pmWriter.createPerson(client, name);
  revalidatePath("/");
  return person;
}

export async function getOrCreateDefaultLayoutAction(createdBy?: string | null) {
  const client = createPmServiceClient();
  return pmWriter.getOrCreateDefaultLayout(client, createdBy);
}

/** Clears every saved position/colour for this layout — never node/todo/note/file data. See pmWriter.resetLayout's own header comment for why this is scoped the way it is. */
export async function resetLayoutAction(layoutId: string) {
  const client = createPmServiceClient();
  const count = await pmWriter.resetLayout(client, layoutId);
  revalidatePath("/");
  return count;
}

/** FormData-based: the browser sends raw file bytes to this action, never to Storage directly (no anon write policy exists on the bucket either — see 0002_pm_layer.sql). Accepts a null/absent nodeKey as an UNSORTED drop. */
export async function uploadFileAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof Blob)) throw new Error("uploadFileAction: no file provided");
  const nodeKey = (formData.get("nodeKey") as string | null) || null;
  const createdBy = (formData.get("createdBy") as string | null) || null;
  const fileName = file instanceof File ? file.name : "upload";

  const client = createPmServiceClient();
  const bytes = await file.arrayBuffer();
  const record = await pmWriter.uploadFile(client, { fileName, contentType: file.type || null, bytes, nodeKey, createdBy });
  revalidatePath("/");
  return record;
}

/** Adds one more UI screenshot for a node — real Storage upload, never a session-only data URL. Unbounded: see addUiScreenshot's own comment for what replaced the old 4-slot cap. */
export async function addUiScreenshotAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof Blob)) throw new Error("addUiScreenshotAction: no file provided");
  const nodeKey = formData.get("nodeKey") as string | null;
  if (!nodeKey) throw new Error("addUiScreenshotAction: nodeKey is required");
  const createdBy = (formData.get("createdBy") as string | null) || null;
  const fileName = file instanceof File ? file.name : "upload";

  const client = createPmServiceClient();
  const bytes = await file.arrayBuffer();
  const record = await pmWriter.addUiScreenshot(client, { nodeKey, fileName, contentType: file.type || null, bytes, createdBy });
  revalidatePath("/");
  return record;
}

/** Removes a file by id — an ordinary DROP-tab file or a UI screenshot, neither of which has a fixed slot identity worth deleting any other way. */
export async function deleteFileAction(fileId: string) {
  const client = createPmServiceClient();
  await pmWriter.deleteFile(client, fileId);
  revalidatePath("/");
}

/** Work-state is global per node_key, independent of any layout — see pmWriter.setNodeState's own header comment. Valid for a canonical node_key just as much as a PM one. */
export async function setNodeStateAction(nodeKey: string, state: PmNodeState["state"], updatedBy?: string | null) {
  const client = createPmServiceClient();
  const row = await pmWriter.setNodeState(client, { nodeKey, state, updatedBy });
  revalidatePath("/");
  return row;
}

/** Deletes a PM-created node and everything real that points at it. Throws for a canonical node_key — see pmWriter.deletePmNode's own header comment for why that's enforced by the data model, not a duplicated kind-check here. */
export async function deletePmNodeAction(nodeKey: string) {
  const client = createPmServiceClient();
  await pmWriter.deletePmNode(client, nodeKey);
  revalidatePath("/");
}
