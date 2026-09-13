// The web half of the doorway onto CommandOS. The other half is
// apps/command/web_bridge.py, in the SALONX AIOS workspace; 0008_ai_bridge.sql is the
// table between them and carries the reasoning for why a queue is the shape.
//
// Nothing here talks to a model. It writes a question down and reads an answer back, and
// everything that makes the answer worth having — the vault, the workspace, CLAUDE.md,
// the primed session, Bash — lives in a process on Shawn's machine that this file cannot
// see and does not need to.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AiMessageRole = "user" | "assistant";
export type AiMessageStatus = "pending" | "running" | "done" | "error";

export interface AiMessage {
  id: string;
  threadId: string;
  role: AiMessageRole;
  content: string;
  fileIds: string[];
  status: AiMessageStatus;
  error: string | null;
  costUsd: number | null;
  createdAt: string;
  answeredAt: string | null;
}

export interface AiThread {
  id: string;
  title: string | null;
  agentSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

function messageFromRow(row: Row): AiMessage {
  return {
    id: row.id as string,
    threadId: row.thread_id as string,
    role: row.role as AiMessageRole,
    content: (row.content as string) ?? "",
    fileIds: (row.file_ids as string[]) ?? [],
    status: row.status as AiMessageStatus,
    error: (row.error as string) ?? null,
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    createdAt: row.created_at as string,
    answeredAt: (row.answered_at as string) ?? null,
  };
}

function threadFromRow(row: Row): AiThread {
  return {
    id: row.id as string,
    title: (row.title as string) ?? null,
    agentSessionId: (row.agent_session_id as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function createThread(client: SupabaseClient): Promise<AiThread> {
  const { data, error } = await client.from("ai_threads").insert({}).select().single();
  if (error) throw new Error(`createThread: ${error.message}`);
  return threadFromRow(data);
}

/**
 * The conversation the hub reopens into, creating one the first time.
 *
 * Held in the database rather than in the browser so that closing the panel, reloading
 * the map, or opening it on a phone all land in the same thread — the conversation is a
 * fact about the brain, not about the tab it was typed in. It is also why there is no
 * localStorage here: this app took every piece of real state out of localStorage
 * deliberately, and a pointer to a conversation is real state.
 *
 * Retried once: confirmed live 2026-09-11, this is the query that runs the instant the
 * panel mounts, and a transient Supabase gateway timeout on that very first request
 * crashed the whole panel with a raw, Next.js-redacted error — one bad round trip made
 * the hub look broken rather than momentarily slow. A plain `select ... limit 1` has no
 * side effect to duplicate, so retrying it blindly is safe in a way `queueUserMessage`'s
 * insert is not.
 */
export async function latestOrNewThread(client: SupabaseClient): Promise<AiThread> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
    const { data, error } = await client
      .from("ai_threads")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (!error) {
      if (data?.length) return threadFromRow(data[0]);
      return createThread(client);
    }
    lastError = error.message;
  }
  throw new Error(`latestOrNewThread: ${lastError}`);
}

/**
 * Queues a question. Returns immediately with the row in `pending` — the bridge may take
 * seconds or minutes, and a Server Action that waited would hit Vercel's function
 * timeout long before a real piece of work finished. The UI polls `readThread`.
 */
export async function queueUserMessage(
  client: SupabaseClient,
  input: { threadId: string; content: string; fileIds?: string[] },
): Promise<AiMessage> {
  const { data, error } = await client
    .from("ai_messages")
    .insert({
      thread_id: input.threadId,
      role: "user",
      content: input.content,
      file_ids: input.fileIds ?? [],
      status: "pending",
    })
    .select()
    .single();
  if (error) throw new Error(`queueUserMessage: ${error.message}`);

  await client.from("ai_threads").update({ updated_at: new Date().toISOString() }).eq("id", input.threadId);
  return messageFromRow(data);
}

/** The whole conversation, oldest first — transcript and queue state in one read. */
/**
 * Retried once for the same reason latestOrNewThread is: a transient Supabase gateway
 * timeout. This one is called every POLL_MS while the panel is open — confirmed live
 * 2026-09-13 (Codeman), same "Gateway Timeout" surfacing as a raw, Next.js-redacted error
 * mid-conversation, not just on first open. Read-only, no side effect to duplicate.
 */
export async function readThread(client: SupabaseClient, threadId: string): Promise<AiMessage[]> {
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
    const { data, error } = await client
      .from("ai_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });
    if (!error) return (data ?? []).map(messageFromRow);
    lastError = error.message;
  }
  throw new Error(`readThread: ${lastError}`);
}

/**
 * Whether anything is on the other side of the door.
 *
 * A pending message that nobody has claimed for a while means CommandOS is not running —
 * which is a normal state, not a fault, and the difference matters: "the brain is offline"
 * and "the brain is thinking" look identical from here for the first few seconds and must
 * stop looking identical after that, or the user is left staring at a spinner that will
 * never resolve.
 */
export function bridgeStalled(messages: AiMessage[], staleAfterSeconds = 25): boolean {
  const waiting = messages.find((m) => m.status === "pending");
  if (!waiting) return false;
  return Date.now() - new Date(waiting.createdAt).getTime() > staleAfterSeconds * 1000;
}
