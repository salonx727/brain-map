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
import type { PmItem, PmNodeState, PmReference } from "@/lib/types/pm";

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

export async function createPmNodeAction(input: { label: string; parentNodeKey?: string | null; kind?: "subnode" | "function"; createdBy?: string | null }) {
  const client = createPmServiceClient();
  const node = await pmWriter.createPmNode(client, input);
  revalidatePath("/");
  return node;
}

export async function renamePmNodeAction(nodeKey: string, label: string, updatedBy?: string | null) {
  const client = createPmServiceClient();
  const node = await pmWriter.renamePmNode(client, nodeKey, label, updatedBy);
  revalidatePath("/");
  return node;
}

export async function createNodeLinkAction(input: { fromNodeKey: string; toNodeKey: string; citation?: string | null; createdBy?: string | null }) {
  const client = createPmServiceClient();
  const link = await pmWriter.createNodeLink(client, input);
  revalidatePath("/");
  return link;
}

export async function deleteNodeLinkAction(id: string) {
  const client = createPmServiceClient();
  await pmWriter.deleteNodeLink(client, id);
  revalidatePath("/");
}

export async function upsertLayoutPositionAction(input: { layoutId: string; nodeKey: string; x: number; y: number; color?: string | null; updatedBy?: string | null }) {
  const client = createPmServiceClient();
  const position = await pmWriter.upsertLayoutPosition(client, input);
  // No revalidatePath here on purpose — position drags happen far more often than any
  // other write in this file, and re-rendering the whole canonical+PM tree on every
  // drag frame would be wasteful. The canvas already holds position in local state;
  // this call just persists it.
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

/** One of the four fixed UI-tab image slots (0–3) — real Storage upload, never a session-only data URL. */
export async function setUiSlotAction(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof Blob)) throw new Error("setUiSlotAction: no file provided");
  const nodeKey = formData.get("nodeKey") as string | null;
  if (!nodeKey) throw new Error("setUiSlotAction: nodeKey is required");
  const slotIndex = Number(formData.get("slotIndex"));
  const createdBy = (formData.get("createdBy") as string | null) || null;
  const fileName = file instanceof File ? file.name : "upload";

  const client = createPmServiceClient();
  const bytes = await file.arrayBuffer();
  const record = await pmWriter.setUiSlot(client, { nodeKey, slotIndex, fileName, contentType: file.type || null, bytes, createdBy });
  revalidatePath("/");
  return record;
}

export async function clearUiSlotAction(nodeKey: string, slotIndex: number) {
  const client = createPmServiceClient();
  await pmWriter.clearUiSlot(client, { nodeKey, slotIndex });
  revalidatePath("/");
}

/** Removes an ordinary DROP-tab file (never a UI slot — see clearUiSlotAction for that). */
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
