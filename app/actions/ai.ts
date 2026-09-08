"use server";

// The AI hub's two Server Actions, and the boundary between them is the whole design.
//
//   askAiHubAction   — reads the graph, asks the provider, returns proposals. Writes nothing.
//   applyAiProposalAction — turns ONE already-approved proposal into ONE real row.
//
// Splitting them is what makes "the AI proposes, a person decides" true at runtime rather
// than by convention: asking can never write, and applying is only ever reached from an
// explicit human approval in the UI. The apply path deliberately does not accept a batch —
// approving a list one row at a time is the point, and a single "apply all" entry point
// would quietly recreate the autonomous-write path this shape exists to avoid.
//
// Every branch below calls the same pmWriter function the equivalent hand-driven action in
// pm.ts calls. The AI can propose nothing a person could not already do by clicking, and
// this file adds no capability that did not already exist.

import { revalidatePath } from "next/cache";
import { createPmServiceClient } from "@/lib/pm/serviceClient";
import * as pmWriter from "@/lib/pm/pmWriter";
import { askAiHub } from "@/lib/ai/hub";
import { getCanonicalGraph } from "@/lib/graph/getCanonicalGraph";
import { getWholeBoardPmLayer } from "@/lib/graph/getPmLayer";
import { OWNER_KEYS } from "@/lib/owners";
import type { AiHubRequest, AiHubResponse, AiProposal } from "@/lib/ai/types";

export async function askAiHubAction(request: AiHubRequest): Promise<AiHubResponse> {
  return askAiHub(request);
}

/** Node keys and file ids that actually exist right now — the proposal is checked against
 * live data, not against whatever the graph looked like when it was generated. A proposal
 * arrives back from the browser and is therefore untrusted input, exactly like any other
 * Server Action argument. */
async function currentGraphIdentity(): Promise<{ nodeKeys: Set<string>; fileIds: Set<string> }> {
  const canonical = await getCanonicalGraph();
  // Read the whole board, and name the owner cards explicitly — the same set the map and
  // buildAiContext use. Scoped to canonical keys, this rejected a proposal aimed at
  // CODEMAN, SHAWN, or any PM card with no canonical parent, all of which the AI can see
  // and a person can already act on by hand. A validator narrower than the surface it
  // guards refuses legitimate work and calls it a missing node.
  const pm = await getWholeBoardPmLayer([...canonical.nodes.map((n) => n.nodeKey), ...OWNER_KEYS]);
  const nodeKeys = new Set<string>([...canonical.nodes.map((n) => n.nodeKey), ...pm.nodes.map((n) => n.nodeKey), ...OWNER_KEYS]);
  return { nodeKeys, fileIds: new Set(pm.files.map((f) => f.id)) };
}

export async function applyAiProposalAction(proposal: AiProposal, approvedBy?: string | null): Promise<void> {
  const { nodeKeys, fileIds } = await currentGraphIdentity();

  const requireNode = (key: string) => {
    if (!nodeKeys.has(key)) {
      throw new Error(`Cannot apply: "${key}" is not a node in the current graph.`);
    }
  };

  const client = createPmServiceClient();

  switch (proposal.kind) {
    case "add_item": {
      if (proposal.nodeKey) requireNode(proposal.nodeKey);
      await pmWriter.createItem(client, {
        kind: proposal.itemKind,
        title: proposal.title,
        nodeKey: proposal.nodeKey,
        detail: proposal.detail,
        createdBy: approvedBy ?? null,
      });
      break;
    }
    case "add_note": {
      if (proposal.nodeKey) requireNode(proposal.nodeKey);
      await pmWriter.createNote(client, {
        kind: proposal.noteKind,
        body: proposal.body,
        nodeKey: proposal.nodeKey,
        createdBy: approvedBy ?? null,
      });
      break;
    }
    case "set_node_state": {
      requireNode(proposal.nodeKey);
      await pmWriter.setNodeState(client, { nodeKey: proposal.nodeKey, state: proposal.state, updatedBy: approvedBy ?? null });
      break;
    }
    case "route_file": {
      requireNode(proposal.nodeKey);
      if (!fileIds.has(proposal.fileId)) {
        throw new Error("Cannot apply: that file no longer exists.");
      }
      await pmWriter.assignFileToNode(client, proposal.fileId, proposal.nodeKey);
      break;
    }
    case "create_link": {
      requireNode(proposal.fromNodeKey);
      requireNode(proposal.toNodeKey);
      // The canonical-to-canonical rejection is a database trigger (0002_pm_layer.sql),
      // not a check here — same reason as everywhere else in this app: the constraint
      // holds even if a caller forgets it.
      await pmWriter.createNodeLink(client, {
        fromNodeKey: proposal.fromNodeKey,
        toNodeKey: proposal.toNodeKey,
        citation: proposal.citation ?? null,
        createdBy: approvedBy ?? null,
      });
      break;
    }
  }

  revalidatePath("/");
  revalidatePath("/v2");
}
