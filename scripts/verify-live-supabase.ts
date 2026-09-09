// One-off manual verification against a live Supabase project — NOT part of `npm test`
// (it mutates real project state and its outcome depends on what's already published,
// so it isn't a repeatable regression test). Run once after sync-coyote.ts has published
// at least one real snapshot. Exercises exactly what unit tests can't: a real rejected
// publish leaving the real active snapshot untouched, and real RLS denial.

import { createClient } from "@supabase/supabase-js";
import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";
import { publishSnapshot } from "../lib/canonical/publisher";
import { fetchCanonicalGraphFromSupabase } from "../lib/canonical/supabaseReader";

async function main() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) throw new Error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY must all be set.");

  const svc = createClient(url, serviceKey);
  const anon = createClient(url, anonKey);

  const before = await svc.from("canonical_sync_state").select("*").eq("id", true).single();
  console.log("=== BEFORE ===", JSON.stringify(before.data));

  // --- 1. Failed-validation rollback: real data, one deliberately dangling edge injected ---
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(resolved.diagnostic.message);
  const parsed = parseCanonicalNodes(resolved.source);
  const corrupted = {
    ...parsed,
    connections: [
      {
        fromNodeKey: "engine:E01",
        toNodeKey: "engine:E99_DOES_NOT_EXIST",
        type: "data_flow" as const,
        directed: true as const,
        backward: false,
        evidenceClass: "declared" as const,
        declaringCitation: "verify-live-supabase.ts — deliberately invalid, not real canon",
      },
    ],
  };
  const rejectResult = await publishSnapshot(svc, resolved.source.text, resolved.source.fileName, 379, corrupted);
  console.log("=== REJECT RESULT ===", JSON.stringify(rejectResult));

  const after = await svc.from("canonical_sync_state").select("*").eq("id", true).single();
  console.log("=== AFTER (active_snapshot_id must be unchanged from BEFORE; sync_status failed) ===", JSON.stringify(after.data));
  console.log("ROLLBACK HELD:", after.data?.active_snapshot_id === before.data?.active_snapshot_id);

  // --- 2. RLS boundary: anon key must not be able to write to a canonical table ---
  const anonWrite = await anon.from("canonical_nodes").insert({
    snapshot_id: before.data?.active_snapshot_id,
    node_key: "verify:should_be_denied",
    kind: "intake",
    label: "x",
    canon_refs: [],
    field_states: {},
  });
  console.log("=== ANON WRITE ATTEMPT ===", anonWrite.error ? `DENIED: ${anonWrite.error.message}` : "NO ERROR — THIS IS A REAL PROBLEM");

  // --- 3. Reader path: anon-key read of the published snapshot, as Next.js would do it ---
  const graph = await fetchCanonicalGraphFromSupabase(anon);
  console.log("=== READER (anon key) ===", JSON.stringify({
    nodeCount: graph.nodes.length,
    connectionCount: graph.connections.length,
    diagnosticCount: graph.diagnostics.length,
    sourceError: graph.sourceError,
  }));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
