// The outbound provider call, and nothing else. Deliberately split from hub.ts the same
// way publisher.ts splits its decision logic from its Supabase call: everything here
// except `callClaude` is pure and unit-testable with no network and no API key.
//
// Plain `fetch` against the Messages API rather than a provider SDK — this app's whole
// dependency list is five packages, and the request shape used here (one turn, tools, no
// streaming) is small enough that an SDK would add more surface than it removes.
//
// A proposal is expressed as a TOOL the model may call. That is the entire mechanism
// behind "the AI proposes, a person decides": a tool call is captured and turned into an
// `AiProposal`, and nothing in this file or hub.ts can execute one. The model has no tool
// available to it that writes anything, because no such tool is declared here.

import type { AiProposal } from "@/lib/ai/types";

/** Overridable because model ids age faster than this file does. */
const DEFAULT_MODEL = "claude-sonnet-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 4096;

export const SYSTEM_PROMPT = `You are the AI hub inside the SALON X Visual Brain — an internal work surface that maps the platform's engines, intake objects and the project-management layer hanging off them.

You are given a read-only rendering of the current graph: nodes, their work states, to-dos, blockers, wires between them, and any unrouted files.

Answer questions directly against that graph. Do not invent nodes, sections, LOCK ids or files that do not appear in the context you were given — if something is not there, say it is not there.

You cannot change anything yourself. When the right response is an action rather than an answer, call the matching propose_* tool. Every proposal is shown to a person who approves or rejects it before anything is written, so propose the action you actually think is right and say plainly why in the reason field. You may call several tools in one turn, and you should still write a short answer explaining what you proposed.

COYOTE is canon and is never edited from here. Never propose changing canonical content — proposals only ever touch the project-management layer.`;

/** Every tool the model may call. All of them propose; none of them write. */
export const AI_TOOLS = [
  {
    name: "propose_add_item",
    description: "Propose adding a to-do or a blocker, optionally attached to a node.",
    input_schema: {
      type: "object",
      properties: {
        item_kind: { type: "string", enum: ["todo", "blocker"] },
        node_key: { type: ["string", "null"], description: "The node this belongs to, or null to leave it unattached." },
        title: { type: "string" },
        detail: { type: "string" },
        reason: { type: "string", description: "Why this should exist — shown to the person approving it." },
      },
      required: ["item_kind", "title", "reason"],
    },
  },
  {
    name: "propose_add_note",
    description: "Propose recording a note or a decision against a node.",
    input_schema: {
      type: "object",
      properties: {
        note_kind: { type: "string", enum: ["note", "decision"] },
        node_key: { type: ["string", "null"] },
        body: { type: "string" },
        reason: { type: "string" },
      },
      required: ["note_kind", "body", "reason"],
    },
  },
  {
    name: "propose_set_node_state",
    description: "Propose changing a node's work state.",
    input_schema: {
      type: "object",
      properties: {
        node_key: { type: "string" },
        state: { type: "string", enum: ["UNTOUCHED", "IN_BUILD", "BLOCKED", "DONE", "OUT_OF_SCOPE"] },
        reason: { type: "string" },
      },
      required: ["node_key", "state", "reason"],
    },
  },
  {
    name: "propose_route_file",
    description: "Propose filing an unrouted file onto a node. Use the file id exactly as it appears in the context.",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
        node_key: { type: "string" },
        reason: { type: "string" },
      },
      required: ["file_id", "node_key", "reason"],
    },
  },
  {
    name: "propose_create_link",
    description: "Propose wiring two nodes together. At least one end must be a PM-created node — canonical-to-canonical edges come from COYOTE, never from here.",
    input_schema: {
      type: "object",
      properties: {
        from_node_key: { type: "string" },
        to_node_key: { type: "string" },
        citation: { type: "string" },
        reason: { type: "string" },
      },
      required: ["from_node_key", "to_node_key", "reason"],
    },
  },
] as const;

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
}

/**
 * Builds the request body. `contextSummary` is the read-only graph rendering from
 * buildAiContext — it goes in as a user-turn preamble rather than in the system prompt so
 * it is unmistakably data the model was handed, not instructions it must obey.
 */
export function buildRequestBody(contextSummary: string, userText: string, model = DEFAULT_MODEL) {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: AI_TOOLS,
    messages: [
      {
        role: "user" as const,
        content: `Current graph:\n\n${contextSummary}\n\n---\n\n${userText}`,
      },
    ],
  };
}

function str(input: Record<string, unknown>, key: string): string | null {
  const v = input[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function nullableStr(input: Record<string, unknown>, key: string): string | null {
  const v = input[key];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Maps one tool call onto a proposal, or returns null if the model produced something
 * that does not satisfy the tool's own contract. Returning null rather than coercing is
 * the same posture the COYOTE parser takes with an ambiguous section: drop the item and
 * report it, never guess at what was meant and hand back something that looks valid.
 */
export function toolUseToProposal(name: string, input: Record<string, unknown>): AiProposal | null {
  const reason = str(input, "reason");
  if (!reason) return null;

  switch (name) {
    case "propose_add_item": {
      const itemKind = str(input, "item_kind");
      const title = str(input, "title");
      if (!title || (itemKind !== "todo" && itemKind !== "blocker")) return null;
      const detail = nullableStr(input, "detail");
      return {
        kind: "add_item",
        itemKind,
        nodeKey: nullableStr(input, "node_key"),
        title,
        ...(detail ? { detail } : {}),
        reason,
      };
    }
    case "propose_add_note": {
      const noteKind = str(input, "note_kind");
      const body = str(input, "body");
      if (!body || (noteKind !== "note" && noteKind !== "decision")) return null;
      return { kind: "add_note", noteKind, nodeKey: nullableStr(input, "node_key"), body, reason };
    }
    case "propose_set_node_state": {
      const nodeKey = str(input, "node_key");
      const state = str(input, "state");
      const allowed = ["UNTOUCHED", "IN_BUILD", "BLOCKED", "DONE", "OUT_OF_SCOPE"] as const;
      if (!nodeKey || !state || !(allowed as readonly string[]).includes(state)) return null;
      return { kind: "set_node_state", nodeKey, state: state as (typeof allowed)[number], reason };
    }
    case "propose_route_file": {
      const fileId = str(input, "file_id");
      const nodeKey = str(input, "node_key");
      if (!fileId || !nodeKey) return null;
      return { kind: "route_file", fileId, nodeKey, reason };
    }
    case "propose_create_link": {
      const fromNodeKey = str(input, "from_node_key");
      const toNodeKey = str(input, "to_node_key");
      if (!fromNodeKey || !toNodeKey || fromNodeKey === toNodeKey) return null;
      const citation = nullableStr(input, "citation");
      return { kind: "create_link", fromNodeKey, toNodeKey, ...(citation ? { citation } : {}), reason };
    }
    default:
      return null;
  }
}

export interface ParsedProviderReply {
  answer: string;
  proposals: AiProposal[];
  /** Tool calls the model made that did not satisfy their own schema. Surfaced, never silently dropped. */
  discarded: number;
}

/** Splits a provider reply into prose and proposals. Pure — no network, no key. */
export function parseProviderReply(reply: AnthropicResponse): ParsedProviderReply {
  const texts: string[] = [];
  const proposals: AiProposal[] = [];
  let discarded = 0;

  for (const block of reply.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(block.text);
      continue;
    }
    if (block.type === "tool_use" && typeof block.name === "string") {
      const proposal = toolUseToProposal(block.name, block.input ?? {});
      if (proposal) proposals.push(proposal);
      else discarded += 1;
    }
  }

  return { answer: texts.join("\n").trim(), proposals, discarded };
}

/**
 * The one impure function here. The key is used for this call and never stored, logged or
 * returned — including in the error paths below, which report status codes and the
 * provider's own message but never echo the request headers.
 */
export async function callClaude(apiKey: string, contextSummary: string, userText: string): Promise<AnthropicResponse> {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(buildRequestBody(contextSummary, userText, model)),
    });
  } catch (err) {
    throw new Error(`Could not reach the Claude API: ${(err as Error).message}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Claude API returned ${response.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`);
  }

  return (await response.json()) as AnthropicResponse;
}
