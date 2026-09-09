// The AI hub's server-side entry point. Read-only by construction, the same way
// getPmLayer.ts is: this file imports getCanonicalGraph.ts and pmReader.ts only — never
// pmWriter.ts, never a Server Action that writes. That's what makes "the AI reads the map
// and answers against it, it does not write" an architectural guarantee instead of a rule
// someone has to remember to follow — the import graph itself cannot reach a write path.
//
// That guarantee survives the move to propose-and-approve (2026-09-07). A proposal is
// inert data returned to the caller; turning one into a row is
// `src/app/actions/ai.ts:applyAiProposalAction`, which a person triggers by approving it.
// Nothing in this module can call that, and it is not imported here.

import { getCanonicalGraph } from "@/lib/graph/getCanonicalGraph";
import { getWholeBoardPmLayer } from "@/lib/graph/getPmLayer";
import { buildModel } from "@/lib/adapter";
import { OWNER_KEYS } from "@/lib/owners";
import { callClaude, parseProviderReply } from "@/lib/ai/provider";
import type { AiHubRequest, AiHubResponse, AiRoutingSuggestion } from "@/lib/ai/types";
import type { BrainNode, Model } from "@/lib/types";

/** The minimum a file reference needs to be named in a prompt — never its bytes. */
export interface AiContextFile {
  id: string;
  name: string;
  nodeKey: string | null;
}

export interface AiContext {
  /** Plain-text rendering of the scoped (or whole) graph — canonical fields plus PM
   * content, the same data DetailPanel.tsx already renders, just flattened for a prompt
   * instead of a UI. No file bytes: a file reference becomes its name/citation only,
   * never its contents — keeping images/binaries out of a text prompt is a real
   * constraint, not a v1 corner cut, so this shape doesn't need to change when a real
   * provider call is added. */
  summary: string;
  nodeCount: number;
  /** Every file the prompt named, so a caller can resolve an id back to a filename
   * without a second round trip to Supabase. */
  files: AiContextFile[];
  /** Set when the canonical source could not be read. Carried rather than swallowed: a
   * failed read and a genuinely empty graph produce the same empty node list here, and
   * collapsing those two is the exact defect this whole app was built to stop making
   * (see FieldValue's "disconnected must never become empty"). askAiHub refuses to send
   * a prompt when this is set — an AI answering confidently about a map it never
   * received is the same lie in a new place. */
  sourceError?: string;
}

/** One card, rendered the way the card itself reads. */
function renderNode(node: BrainNode, model: Model): string {
  const lines = [`${node.id} — ${node.name || node.ref} [${node.ref}${node.sec ? ` ${node.sec}` : ""}] · ${node.state}`];

  // An open ruling is stated because it changes what the model may claim about the card:
  // it exists on the map and does NOT exist in canon, so nothing here should be described
  // as settled, and no answer should cite it as though COYOTE said it.
  if (node.awaitingRuling) {
    lines.push(`  [AWAITING RULING${node.rulingRef ? ` ${node.rulingRef}` : ""}] proposed on the map, not in COYOTE — Shawn has not ruled`);
  }

  // `canon` is marked on every item that carries it because the difference decides what
  // the model is allowed to propose about it: a §15 blocker is COYOTE's and cannot be
  // edited from here, while a hand-typed one is ordinary project-management work.
  for (const b of node.blockers) {
    lines.push(`  [BLOCKER${b.done ? " DONE" : ""}${b.canon ? " CANON" : ""}] ${b.text}${b.sec ? ` (${b.sec})` : ""}`);
  }
  for (const t of node.todos) {
    lines.push(`  [TODO${t.done ? " DONE" : ""}${t.canon ? " CANON" : ""}] ${t.text}${t.sec ? ` (${t.sec})` : ""}`);
  }
  // Files are named, never read. The id is included because `propose_route_file` has to
  // cite a real one — a model that could only see filenames would have to invent an id.
  for (const drop of node.drops) {
    if (drop.id) lines.push(`  [FILE ${drop.id}] ${drop.name}`);
  }
  for (const shot of node.screens) {
    if (shot?.id) lines.push(`  [UI SLOT ${shot.id}] ${shot.name}`);
  }
  for (const link of model.links) {
    if (link.a !== node.id) continue;
    lines.push(`  [WIRE${link.canon ? " CANON" : ""}] ${link.a} -> ${link.b}${link.why ? ` (${link.why})` : ""}`);
  }
  return lines.join("\n");
}

/**
 * Builds the exact same read-only context regardless of provider — assembled once here
 * so `askAiHub` (and any future provider-specific implementation) can't accidentally
 * diverge on what "the graph" means between CLAUDE/GPT/OTHER.
 *
 * It is built from `buildModel`, the same function that produces what the map draws,
 * rather than from a second walk over the same tables. That is the point: this used to
 * assemble its own summary from getPmLayer, and had quietly fallen behind the surface it
 * claims to describe — it could not see COYOTE's own blockers and open questions, the
 * CODEMAN and SHAWN owner cards, or any PM card without a canonical parent. An AI
 * answering confidently about a map that is not the one on screen is the same lie as an
 * AI answering about a map it never received, which this file already refuses to do.
 */
export async function buildAiContext(scopeNodeKeys?: string[]): Promise<AiContext> {
  const canonical = await getCanonicalGraph();
  const pm = await getWholeBoardPmLayer([...canonical.nodes.map((n) => n.nodeKey), ...OWNER_KEYS]);
  // No positions: where a card sits is a layout concern and says nothing about the work.
  const model = buildModel(canonical.nodes, canonical.connections, pm, new Map(), canonical.diagnostics);

  const scoped = scopeNodeKeys ? model.order.filter((id) => scopeNodeKeys.includes(id)) : model.order;

  const lines = scoped.map((id) => renderNode(model.nodes[id], model));

  if (!scopeNodeKeys && model.unrouted.length) {
    lines.push(
      ["UNROUTED — files with no card yet", ...model.unrouted.map((f) => (f.id ? `  [FILE ${f.id}] ${f.name}` : `  [FILE] ${f.name}`))].join("\n"),
    );
  }

  const files: AiContextFile[] = pm.files.map((f) => ({ id: f.id, name: f.fileName, nodeKey: f.nodeKey }));

  return {
    summary: lines.join("\n\n"),
    nodeCount: scoped.length,
    files,
    ...(canonical.sourceError ? { sourceError: canonical.sourceError } : {}),
  };
}

/** Flattens one turn's items into prompt text. A file contributes its name and id — never its bytes, per AiIntakeItem's own contract. */
export function renderRequestItems(request: AiHubRequest, files: AiContextFile[]): string {
  const byId = new Map(files.map((f) => [f.id, f]));
  return request.items
    .map((item) => {
      if (item.kind === "text") return item.text;
      const known = byId.get(item.fileId);
      return known
        ? `[attached file: ${known.name} — id ${known.id}${known.nodeKey ? `, filed on ${known.nodeKey}` : ", currently UNROUTED"}]`
        : `[attached file: id ${item.fileId} — not found in the current graph]`;
    })
    .join("\n\n");
}

/**
 * Asks the provider a question about the graph and returns its answer plus any actions it
 * proposes. Never writes: see this module's header comment.
 *
 * The key is taken from the request when the caller brought one (the UI's own "bring your
 * own key, no key is stored here" rule) and otherwise from `ANTHROPIC_API_KEY`, which is
 * what makes a deployed instance usable without anyone typing a credential into a phone.
 * Either way it is used for this call and never persisted or logged.
 */
export async function askAiHub(request: AiHubRequest): Promise<AiHubResponse> {
  if (request.provider !== "claude") {
    // Named rather than silently degraded to Claude: a caller that asked for GPT and
    // quietly got Claude has no way to notice.
    throw new Error(`askAiHub: only the "claude" provider is implemented — "${request.provider}" has no outbound call yet`);
  }

  const apiKey = request.apiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("askAiHub: no API key — supply one in the request, or set ANTHROPIC_API_KEY on the server");
  }

  // Checked before the graph is read: an empty turn is cheap to reject and there is no
  // reason to spend a Supabase round trip discovering it.
  const hasContent = request.items.some((item) => (item.kind === "file" ? item.fileId.trim() !== "" : item.text.trim() !== ""));
  if (!hasContent) {
    throw new Error("askAiHub: the request carried no content to send");
  }

  const context = await buildAiContext(request.scopeNodeKeys);
  if (context.sourceError) {
    throw new Error(`askAiHub: the map could not be read, so there is nothing to ask about — ${context.sourceError}`);
  }
  if (context.nodeCount === 0) {
    throw new Error("askAiHub: the map came back with no nodes — refusing to ask a question against an empty graph");
  }

  const userText = renderRequestItems(request, context.files);
  const reply = await callClaude(apiKey, context.summary, userText);
  const { answer, proposals, discarded } = parseProviderReply(reply);

  const routingSuggestions: AiRoutingSuggestion[] = proposals
    .filter((p) => p.kind === "route_file")
    .map((p) => ({
      itemIndex: request.items.findIndex((item) => item.kind === "file" && item.fileId === p.fileId),
      suggestedNodeKey: p.nodeKey,
      reason: p.reason,
    }));

  return {
    answer: discarded > 0 ? `${answer}\n\n(${discarded} malformed proposal${discarded === 1 ? "" : "s"} discarded.)`.trim() : answer,
    proposals,
    routingSuggestions,
  };
}
