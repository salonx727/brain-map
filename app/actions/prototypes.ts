"use server";

// Read and write for an engine's UI prototype history. Thin wrappers over
// lib/pm/prototypes.ts, same split as pm.ts: the logic lives there so it stays
// unit-testable without Next.js, and this file's only job is the service-role client.

import { createPmServiceClient } from "@/lib/pm/serviceClient";
import { getLatestPrototypeVersion, listPrototypeVersions, signPrototypeUrl, uploadPrototypeVersion } from "@/lib/pm/prototypes";

export interface SignedPrototypeVersion {
  version: number;
  figmaUrl: string | null;
  updatedAt: string | null;
  htmlUrl: string;
}

/** Latest + every earlier version, each carrying a ready-to-click signed HTML link. Empty `previous` and null `latest` for an engine with nothing uploaded — a normal state, not an error the UI needs to handle specially. */
export async function getEnginePrototypesAction(engineKey: string): Promise<{ latest: SignedPrototypeVersion | null; previous: SignedPrototypeVersion[] }> {
  const client = createPmServiceClient();
  const versions = await listPrototypeVersions(client, engineKey);
  if (versions.length === 0) return { latest: null, previous: [] };

  const signed = await Promise.all(
    versions.map(async (v) => ({
      version: v.version,
      figmaUrl: v.figmaUrl,
      updatedAt: v.updatedAt,
      htmlUrl: await signPrototypeUrl(client, v.path),
    })),
  );
  return { latest: signed[0], previous: signed.slice(1) };
}

/**
 * Called from a script, not from any button in the Brain itself — per the design,
 * a new version always arrives because Shawn sent it in Telegram, never by someone
 * picking "latest" here. See scripts/upload-prototype.mjs for the CLI wrapper.
 */
export async function uploadEnginePrototypeAction(input: { engineKey: string; bytes: ArrayBuffer; contentType?: string; figmaUrl?: string | null }) {
  const client = createPmServiceClient();
  return uploadPrototypeVersion(client, input);
}

export async function getLatestEnginePrototypeAction(engineKey: string) {
  const client = createPmServiceClient();
  return getLatestPrototypeVersion(client, engineKey);
}
