// The AI hub's contract — designed now for where this is going (Telegram-like multi-part
// intake, routing suggestions), even though the first real implementation only answers a
// read-only question. Nothing here executes a write; see hub.ts's header comment for why
// that's an architectural guarantee, not just a convention.

import type { PmItemKind, PmNodeWorkState, PmNoteKind } from "@/lib/types/pm";

export type AiProvider = "claude" | "gpt" | "other";

/**
 * One piece of a request — text, or a reference to a file already uploaded through the
 * existing intake pipeline. Bytes never travel through this contract a second time: an
 * image/file is uploaded via `uploadFileAction` first (real Storage, already built), and
 * only the resulting `PmFile.id` is passed here. This is what makes "Telegram-like
 * text/image/file intake" a real extension of what already exists rather than a second
 * upload path — the hub receives references, the existing pipeline still owns bytes.
 */
export type AiIntakeItem = { kind: "text"; text: string } | { kind: "file"; fileId: string };

export interface AiHubRequest {
  provider: AiProvider;
  /** Never persisted — matches the UI's own stated rule ("bring your own key, no key is
   * stored here"). Used for this call only and discarded; hub.ts must never write it
   * anywhere, including logs. */
  apiKey: string;
  /** A single turn's content, ordered — one user message can carry text and file
   * references together, the same shape a Telegram message does. */
  items: AiIntakeItem[];
  /** Node keys to scope context to. Omitted = the whole graph. Present = only these
   * nodes' canonical+PM data are read — lets a future "ask about just this node" mode
   * reuse this same contract instead of forking a second one. */
  scopeNodeKeys?: string[];
}

/**
 * A proposed destination for one intake item — advisory only. Turning a suggestion into a
 * real assignment is an existing, human-clicked action (`assignFileToNodeAction`,
 * `createItemAction`, etc.), never something this contract calls itself. This is what
 * keeps routing suggestions compatible with "read-only": the AI proposes, a person
 * decides — the same shape as every other AI-adjacent boundary in this app.
 */
export interface AiRoutingSuggestion {
  /** Index into the request's `items` array. */
  itemIndex: number;
  suggestedNodeKey: string;
  reason: string;
}

/**
 * One action the AI thinks should happen — a proposal, never a performed write. Each
 * variant maps 1:1 onto a Server Action that already exists and is already reachable by
 * a human clicking the same thing in the UI: the AI can propose nothing a person could
 * not already do by hand, and proposing is all it can do. Executing one is
 * `applyAiProposalAction`'s job, and only after an explicit human approval.
 *
 * `reason` is required on every variant on purpose — an approval prompt with no stated
 * reason is a rubber stamp, and the whole point of this shape is that a person is
 * actually deciding.
 */
export type AiProposal =
  | { kind: "add_item"; itemKind: PmItemKind; nodeKey: string | null; title: string; detail?: string; reason: string }
  | { kind: "add_note"; noteKind: PmNoteKind; nodeKey: string | null; body: string; reason: string }
  | { kind: "set_node_state"; nodeKey: string; state: PmNodeWorkState; reason: string }
  | { kind: "route_file"; fileId: string; nodeKey: string; reason: string }
  | { kind: "create_link"; fromNodeKey: string; toNodeKey: string; citation?: string; reason: string };

export interface AiHubResponse {
  answer: string;
  /** Every action the AI proposes, in the order it proposed them. Empty is the normal
   * case for a plain question — a proposal is only generated when the model actually
   * calls one of the proposal tools. */
  proposals: AiProposal[];
  /** Derived from the `route_file` proposals above, not a second independent source —
   * kept because it was part of this contract before proposals existed and callers may
   * still read it. */
  routingSuggestions: AiRoutingSuggestion[];
}
