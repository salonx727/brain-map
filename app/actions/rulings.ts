"use server";

// The ruling queue's write surface. Same shape and same boundary as app/actions/pm.ts —
// thin wrappers holding the service-role client for the length of one call.
//
// There is deliberately no "approve" action here. A ruling is not approved by tapping the
// map: Shawn writes it into COYOTE himself, the sync publishes it, and retirement below
// runs afterwards to remove the PM row that is now a duplicate. An approve button would
// make this app look like a second author of canon, which it must never be.

import { revalidatePath } from "next/cache";
import { createPmServiceClient } from "@/lib/pm/serviceClient";
import * as rulingWriter from "@/lib/pm/rulingWriter";
import type { ConnectionIntent } from "@/lib/types/pm";

export async function updateRulingIntentAction(nodeKey: string, intent: Partial<ConnectionIntent>) {
  const client = createPmServiceClient();
  const ruling = await rulingWriter.updateRulingIntent(client, nodeKey, intent);
  revalidatePath("/");
  return ruling;
}

export async function rejectRulingAction(nodeKey: string, note?: string | null) {
  const client = createPmServiceClient();
  const ruling = await rulingWriter.rejectRuling(client, nodeKey, note);
  revalidatePath("/");
  return ruling;
}

/** Rejects any ruling by its own id — the only form that works for a link ruling, which has no node_key to key off. */
export async function rejectRulingByIdAction(rulingId: string, note?: string | null) {
  const client = createPmServiceClient();
  const ruling = await rulingWriter.rejectRulingById(client, rulingId, note);
  revalidatePath("/");
  return ruling;
}

/**
 * Confirms that a canonical node in the published snapshot is the card someone drew, and
 * folds the PM row into it. The confirmation is the whole safety mechanism — see
 * findReconcileCandidates in rulingReader.ts for why a label match alone is never enough.
 */
export async function retireRulingAction(pmNodeKey: string, canonicalNodeKey: string) {
  const client = createPmServiceClient();
  await rulingWriter.retirePmNodeIntoCanonical(client, pmNodeKey, canonicalNodeKey);
  revalidatePath("/");
}
