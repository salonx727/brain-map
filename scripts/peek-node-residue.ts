// Everything still keyed to a node_key whose pm_nodes row is gone.
//
// deletePmNode clears its dependents, so a card removed through the app leaves nothing.
// Anything this finds was removed some other way — and what it finds is what could be
// recovered, which is the only question worth asking after a card disappears.
//
//   npx tsx --env-file=.env scripts/peek-node-residue.ts <node_key>

import { createClient } from "@supabase/supabase-js";

async function main() {
  const nodeKey = process.argv[2];
  if (!nodeKey) throw new Error("Usage: peek-node-residue.ts <node_key>");
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: node } = await db.from("pm_nodes").select("*").eq("node_key", nodeKey).maybeSingle();
  console.log(`pm_nodes: ${node ? "PRESENT" : "GONE"}`);

  for (const table of ["pm_items", "pm_notes", "pm_references", "pm_files", "pm_layout_positions", "pm_node_state", "pm_rulings"]) {
    const { data, error } = await db.from(table).select("*").eq("node_key", nodeKey);
    if (error) {
      console.log(`  ${table.padEnd(22)} error: ${error.message}`);
      continue;
    }
    console.log(`  ${table.padEnd(22)} ${data?.length ?? 0}`);
    for (const row of data ?? []) console.log(`      ${JSON.stringify(row)}`);
  }

  const { data: links } = await db.from("pm_node_links").select("*").or(`from_node_key.eq.${nodeKey},to_node_key.eq.${nodeKey}`);
  console.log(`  ${"pm_node_links".padEnd(22)} ${links?.length ?? 0}`);
  for (const l of links ?? []) console.log(`      ${l.from_node_key} -> ${l.to_node_key}  relation=${l.relation ?? "(none)"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
