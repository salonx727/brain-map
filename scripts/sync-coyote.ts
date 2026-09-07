// The local sync job. Run this on the machine that already has the local COYOTE file —
// never inside Vercel/Next.js (see publisher.ts's own header comment). Resolves the
// current COYOTE, parses it, and publishes the result to Supabase using the
// service-role credential — the only credential allowed to write canonical_* tables.
//
// Usage: npm run sync:coyote   (reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env)
//
// Exit 0 on publish or no_op. Exit 1 on rejection (validation failure or a Supabase
// error) — the previous snapshot stays active either way; this script only ever reports.

import { createClient } from "@supabase/supabase-js";
import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";
import { publishSnapshot } from "../lib/canonical/publisher";

/**
 * Approximate count of distinct LOCK-YYMMDD-NNN ids in the raw text — informational
 * only (stored in canonical_snapshots.register_entry_count for audit context), never
 * read by validator.ts or the publish decision. Known to overcount slightly relative to
 * the file's own stated register total, same caveat coyote-index.md's generator carries.
 */
function countRegisterEntries(rawText: string): number {
  const matches = rawText.match(/LOCK-\d{6}-\d+/g) ?? [];
  return new Set(matches).size;
}

async function main(): Promise<number> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    return 1;
  }

  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) {
    console.error(`Resolver failed: ${resolved.diagnostic.message}`);
    return 1;
  }

  const parsed = parseCanonicalNodes(resolved.source);
  const client = createClient(supabaseUrl, serviceRoleKey);

  // --force: republish a byte-identical COYOTE. Needed after an extractor change, which
  // alters the graph without altering the source the hash is taken over.
  const force = process.argv.includes("--force");

  const result = await publishSnapshot(
    client,
    resolved.source.text,
    resolved.source.fileName,
    countRegisterEntries(resolved.source.text),
    parsed,
    force,
  );

  console.log(`Source: ${resolved.source.fileName}`);
  console.log(`Parsed: ${parsed.nodes.length} nodes, ${parsed.connections.length} connections${force ? " (forced republish)" : ""}`);
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);

  return result.kind === "rejected" ? 1 : 0;
}

main().then((code) => process.exit(code));
