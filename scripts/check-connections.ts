// Compares the twenty-one wires the prototype sheet hard-codes (lib/seed.ts WIRES, every
// one of them citing a COYOTE §35.x clause) against what canonical_connections actually
// holds in the live project.
//
// The comparison matters because the two are not peers. The sheet's wires are a hand
// transcription of §35; canonical_connections is what the parser extracted from the
// current COYOTE. If they disagree, the answer is never to type the sheet's version into
// the database — it is to find out why the extractor and the sheet read §35 differently.
//
//   npx tsx --env-file=.env scripts/check-connections.ts

import { createClient } from "@supabase/supabase-js";
import { WIRES } from "../lib/seed";
import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";

/** Sheet ref -> canonical node key. `INT GATE` -> `intake:GATE`, `E01` -> `engine:E01`. */
function keyOf(ref: string): string {
  if (ref.startsWith("INT ")) return `intake:${ref.slice(4)}`;
  return `engine:${ref}`;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: pointer, error: pErr } = await db.from("canonical_sync_state").select("active_snapshot_id").maybeSingle();
  if (pErr) throw new Error(`canonical_sync_state: ${pErr.message}`);
  const snapshotId = pointer?.active_snapshot_id;
  console.log("active snapshot:", snapshotId ?? "(none)");
  if (!snapshotId) {
    console.log("No active snapshot — nothing has been published. Run: npm run sync:coyote");
    return;
  }

  const { data: rows, error } = await db
    .from("canonical_connections")
    .select("from_node_key,to_node_key,declaring_citation,backward")
    .eq("snapshot_id", snapshotId);
  if (error) throw new Error(`canonical_connections: ${error.message}`);

  const inDb = new Set((rows ?? []).map((r) => `${r.from_node_key}->${r.to_node_key}`));
  const inSheet = new Set(WIRES.map(([a, b]) => `${keyOf(a)}->${keyOf(b)}`));

  console.log("wires on the sheet     :", inSheet.size);
  console.log("rows in the database   :", inDb.size);
  console.log("");

  const missing = [...inSheet].filter((e) => !inDb.has(e));
  const extra = [...inDb].filter((e) => !inSheet.has(e));

  console.log(`on the sheet but NOT in the database (${missing.length}):`);
  for (const e of missing) console.log("  " + e);
  console.log("");
  console.log(`in the database but NOT on the sheet (${extra.length}):`);
  for (const e of extra) console.log("  " + e);
  console.log("");

  const backwardDb = (rows ?? []).filter((r) => r.backward).map((r) => `${r.from_node_key}->${r.to_node_key}`);
  const backwardSheet = WIRES.filter((w) => w[3]).map(([a, b]) => `${keyOf(a)}->${keyOf(b)}`);
  console.log("backward edge, sheet   :", backwardSheet.join(", ") || "(none)");
  console.log("backward edge, database:", backwardDb.join(", ") || "(none)");

  // What the CURRENT COYOTE yields when parsed right now, with nothing published. This is
  // the number that decides whether a re-sync would fix an empty graph or whether the
  // extractor is the thing that is broken.
  console.log("");
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) {
    console.log("local COYOTE parse   : resolver failed —", resolved.diagnostic.message);
    return;
  }
  const parsed = parseCanonicalNodes(resolved.source);
  console.log("local COYOTE file    :", resolved.source.fileName);
  console.log("parses to nodes      :", parsed.nodes.length);
  console.log("parses to connections:", parsed.connections.length);
  const parsedSet = new Set(parsed.connections.map((c) => `${c.fromNodeKey}->${c.toNodeKey}`));
  const found = WIRES.filter(([a, b]) => parsedSet.has(`${keyOf(a)}->${keyOf(b)}`));
  const notFound = WIRES.filter(([a, b]) => !parsedSet.has(`${keyOf(a)}->${keyOf(b)}`));
  console.log(`of the sheet's 21, the parser finds ${found.length}:`);
  for (const [a, b, why] of found) console.log(`  FOUND   ${a} -> ${b}   ${why}`);
  console.log("");
  for (const [a, b, why] of notFound) console.log(`  MISSING ${a} -> ${b}   ${why}`);

  // Edges the parser produces that the sheet never drew. Each one is either canon the
  // hand transcription missed, or a false positive — and the two are told apart only by
  // reading the citation, so it is printed in full.
  console.log("");
  const sheetSet = new Set([...inSheet]);
  const surplus = parsed.connections.filter((c) => !sheetSet.has(`${c.fromNodeKey}->${c.toNodeKey}`));
  console.log(`parsed but NOT on the sheet (${surplus.length}):`);
  for (const c of surplus) console.log(`  ${c.fromNodeKey} -> ${c.toNodeKey}\n     ${c.declaringCitation}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
