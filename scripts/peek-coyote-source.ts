// Read-only: which COYOTE the resolver currently picks, and what the canonical layer was
// last published from. Answers "is the map under the latest COYOTE?" without publishing
// anything or printing a credential.
//
//   npx tsx --env-file=.env scripts/peek-coyote-source.ts

import { createClient } from "@supabase/supabase-js";
import { resolveCoyoteSource } from "../lib/coyote/resolver";

async function main() {
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) {
    console.log("resolver: FAILED —", resolved.diagnostic.message);
  } else {
    console.log("resolver picks :", resolved.source.fileName);
    console.log("            in :", resolved.source.filePath.replace(resolved.source.fileName, ""));
    console.log("      modified :", resolved.source.modifiedAt);
    console.log("          size :", Math.round(resolved.source.sizeBytes / 1024) + " KB");
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log("\nsupabase: SUPABASE_URL / SUPABASE_ANON_KEY not set, skipping snapshot check");
    return;
  }
  const { data, error } = await createClient(url, key)
    .from("canonical_sync_state")
    .select("source_filename, register_entry_count, sync_status, synced_at")
    .eq("id", true)
    .single();
  if (error) {
    console.log("\nsupabase: could not read canonical_sync_state —", error.message);
    return;
  }
  console.log("\npublished from :", data.source_filename);
  console.log("       entries :", data.register_entry_count);
  console.log("        status :", data.sync_status);
  console.log("     synced at :", data.synced_at);
}

main();
