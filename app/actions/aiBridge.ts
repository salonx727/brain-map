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
import { createThread, latestOrNewThread, queueUserMessage, readThread, bridgeStalled } from "@/lib/ai/bridge";
import * as pmWriter from "@/lib/pm/pmWriter";
import type { AiMessage } from "@/lib/ai/bridge";

/** Reopens the last conversation, or opens the first one. */
export async function openBrainThreadAction(): Promise<string> {
  const thread = await latestOrNewThread(createPmServiceClient());
  return thread.id;
}

/** Starts a fresh conversation with its own session — the map's answer to Telegram's `/new`. */
export async function startBrainThreadAction(): Promise<string> {
  const thread = await createThread(createPmServiceClient());
  return thread.id;
}

export async function sendToBrainAction(input: { threadId: string; content: string; fileIds?: string[] }): Promise<void> {
  const content = input.content.trim();
  if (!content && !input.fileIds?.length) {
    throw new Error("Nothing to send.");
  }
  await queueUserMessage(createPmServiceClient(), { ...input, content });
}

export interface BrainThreadState {
  messages: AiMessage[];
  /** True once a queued message has sat unclaimed long enough that CommandOS is plainly not listening. */
  stalled: boolean;
}

export async function readBrainThreadAction(threadId: string): Promise<BrainThreadState> {
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
