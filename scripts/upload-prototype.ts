// Pushes one new UI prototype version for one engine. Run this — never a button in the
// Brain — because a version arrives when Shawn sends the file in Telegram, and Claude
// runs this on his behalf against whatever landed in data/command/inbox/. The version
// number is never an argument here: uploadPrototypeVersion always computes next = max+1
// against what Storage already holds, so this script cannot be used to overwrite or
// skip a version by mistake.
//
// Usage:
//   tsx --env-file=.env scripts/upload-prototype.ts <ENGINE_KEY> <path-to.html> [figmaUrl]
//
// ENGINE_KEY is the bare code (E01..E11), matching lib/coyote/nodeRegistry.ts's aliases
// and the "engine:E0N" node key stripped of its prefix — not the engine's name.

import { readFile } from "node:fs/promises";
import { createPmServiceClient } from "../lib/pm/serviceClient";
import { uploadPrototypeVersion } from "../lib/pm/prototypes";

const ENGINE_KEY_RE = /^E(0[1-9]|1[01])$/;

async function main(): Promise<number> {
  const [engineKey, filePath, figmaUrl] = process.argv.slice(2);
  if (!engineKey || !filePath) {
    console.error("Usage: tsx --env-file=.env scripts/upload-prototype.ts <ENGINE_KEY> <path-to.html> [figmaUrl]");
    return 1;
  }
  if (!ENGINE_KEY_RE.test(engineKey)) {
    console.error(`"${engineKey}" is not a recognized engine key — expected E01..E11.`);
    return 1;
  }

  const bytes = await readFile(filePath);
  const client = createPmServiceClient();
  const result = await uploadPrototypeVersion(client, {
    engineKey,
    bytes,
    contentType: "text/html",
    figmaUrl: figmaUrl || null,
  });

  console.log(`Uploaded ${engineKey} v${result.version} (${result.path})${figmaUrl ? ` — Figma: ${figmaUrl}` : ""}`);
  return 0;
}

main().then((code) => process.exit(code));
