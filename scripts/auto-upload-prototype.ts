// The automatic counterpart to upload-prototype.ts. That script needs a human to already
// know which engine a file belongs to; this one works it out from the file's own <title>
// and uploads only when exactly one engine matches — reusing matchRegistryEntries()
// (lib/coyote/nodeRegistry.ts), the same whole-word matcher Phase 2's own parser uses,
// so "what counts as a confident match" is never redefined twice. A watcher calling this
// needs to tell "uploaded" from "needs a person" without parsing prose, so the three
// outcomes are distinct exit codes, not just log lines.
//
// Usage:
//   tsx --env-file=.env scripts/auto-upload-prototype.ts <path-to.html>
//
// Exit codes: 0 uploaded · 2 no engine matched (or no <title> at all) · 3 more than one
// engine matched, e.g. a filename mentioning two engines in passing.

import { readFile } from "node:fs/promises";
import { createPmServiceClient } from "../lib/pm/serviceClient";
import { uploadPrototypeVersion } from "../lib/pm/prototypes";
import { matchRegistryEntries } from "../lib/coyote/nodeRegistry";

async function main(): Promise<number> {
  const [filePath] = process.argv.slice(2);
  if (!filePath) {
    console.error("Usage: tsx --env-file=.env scripts/auto-upload-prototype.ts <path-to.html>");
    return 1;
  }

  const bytes = await readFile(filePath);
  // The title, not the whole file: a KPI dashboard prototype's own body text can
  // legitimately name every engine it reads from, which would make body-text matching
  // ambiguous on nearly everything. The title is the one place a prototype states what
  // it itself is, not what it reads.
  const titleMatch = /<title>([^<]*)<\/title>/i.exec(bytes.toString("utf8", 0, 4096));
  const title = titleMatch?.[1]?.trim() ?? "";
  if (!title) {
    console.log("NO_TITLE — cannot determine the engine without one");
    return 2;
  }

  const matches = matchRegistryEntries(title).filter((e) => e.kind === "engine");
  if (matches.length === 0) {
    console.log(`NO_MATCH — no engine name found in title: "${title}"`);
    return 2;
  }
  if (matches.length > 1) {
    console.log(`AMBIGUOUS — title "${title}" matches ${matches.map((m) => m.label).join(", ")}`);
    return 3;
  }

  const engineKey = matches[0].nodeKey.replace("engine:", "");
  const client = createPmServiceClient();
  const result = await uploadPrototypeVersion(client, { engineKey, bytes, contentType: "text/html" });
  console.log(`UPLOADED ${engineKey} v${result.version} (${result.path}) — matched title "${title}"`);
  return 0;
}

main().then((code) => process.exit(code));
