"use server";

// Server Actions for the brain bridge. Every one of them holds the service-role key,
// because 0008_ai_bridge.sql grants the two bridge tables to nobody else — the browser
// cannot read or write them directly even with the anon key it already ships with.
//
// These do not call a model and they do not wait for one. Sending queues a row; the
// answer arrives when apps/command/web_bridge.py has written it and the UI's next poll
// picks it up. A Server Action that blocked until the agent finished would time out on
// Vercel long before a real piece of work — a vault search, a file filed, a chart drawn —
// was done, and the timeout would look like a failure when the work had actually run.

import { createPmServiceClient } from "@/lib/pm/serviceClient";
import {
  createThread,
  latestOrNewThread,
  originOfThisDeployment,
  queueUserMessage,
  readThread,
  bridgeStalled,
} from "@/lib/ai/bridge";
import { brainGateConfigured, brainUnlocked, closeBrainGate, openBrainGate, requireBrainUnlocked } from "@/lib/ai/brainGate";
import * as pmWriter from "@/lib/pm/pmWriter";
import type { AiMessage } from "@/lib/ai/bridge";

export interface BrainGateState {
  /** Whether this deployment asks for a passphrase at all. */
  required: boolean;
  /** Whether this browser has already given it. */
  open: boolean;
}

/** What the panel needs to decide between showing the lock and showing the conversation. */
export async function brainGateStateAction(): Promise<BrainGateState> {
  return { required: brainGateConfigured(), open: await brainUnlocked() };
}

/** Returns false on a wrong passphrase rather than throwing — a typo is not an error. */
export async function unlockBrainAction(passphrase: string): Promise<boolean> {
  return openBrainGate(passphrase);
}

export async function lockBrainAction(): Promise<void> {
  await closeBrainGate();
}

/** Reopens the last conversation, or opens the first one. */
export async function openBrainThreadAction(): Promise<string> {
  await requireBrainUnlocked();
  const thread = await latestOrNewThread(createPmServiceClient());
  return thread.id;
}

/** Starts a fresh conversation with its own session — the map's answer to Telegram's `/new`. */
export async function startBrainThreadAction(): Promise<string> {
  await requireBrainUnlocked();
  const thread = await createThread(createPmServiceClient());
  return thread.id;
}

export async function sendToBrainAction(input: { threadId: string; content: string; fileIds?: string[] }): Promise<void> {
  await requireBrainUnlocked();
  const content = input.content.trim();
  if (!content && !input.fileIds?.length) {
    throw new Error("Nothing to send.");
  }
  await queueUserMessage(createPmServiceClient(), { ...input, content, origin: originOfThisDeployment() });
}

export interface BrainThreadState {
  messages: AiMessage[];
  /** True once a queued message has sat unclaimed long enough that CommandOS is plainly not listening. */
  stalled: boolean;
}

export async function readBrainThreadAction(threadId: string): Promise<BrainThreadState> {
  // Gated as hard as sending. Threads are global, so the transcript of someone else's
  // conversation with an agent that can read the vault is exactly as sensitive as the
  // ability to start one.
  await requireBrainUnlocked();
  const messages = await readThread(createPmServiceClient(), threadId);
  return { messages, stalled: bridgeStalled(messages) };
}

/**
 * Uploads an attachment and returns its pm_files id, which travels on the message.
 *
 * Deliberately the same pipeline and the same bucket as a file dropped on a card — an
 * upload is an upload, and a second storage path for "AI attachments" would mean a file
 * sent to the brain was invisible to the map and vice versa. `nodeKey: null` files it as
 * UNSORTED, which is exactly what it is until the agent decides where it belongs.
 */
export async function uploadForBrainAction(formData: FormData): Promise<{ id: string; fileName: string }> {
  await requireBrainUnlocked();
  const file = formData.get("file");
  if (!(file instanceof Blob)) throw new Error("uploadForBrainAction: no file provided");
  const fileName = file instanceof File ? file.name : "upload";

  const stored = await pmWriter.uploadFile(createPmServiceClient(), {
    fileName,
    bytes: Buffer.from(await file.arrayBuffer()),
    contentType: file.type || null,
    nodeKey: null,
    createdBy: null,
  });
  return { id: stored.id, fileName: stored.fileName };
}
