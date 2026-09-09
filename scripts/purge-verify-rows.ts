/**
 * Removes rows left behind by scripts/verify-writes.mjs when a run failed part-way.
 *
 * Matches on the "verify-write-" label prefix only — never a general cleanup, and never
 * anything a person could have typed by hand. Dry by default; pass --apply to delete.
 *
 *   npx tsx --env-file=.env scripts/purge-verify-rows.ts [--apply]
 */
import { createClient } from "@supabase/supabase-js";

const PREFIX = "verify-write-";

async function main() {
  const apply = process.argv.includes("--apply");
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: nodes, error: nodesError } = await client
    .from("pm_nodes")
    .select("node_key, display_ref, label")
    .like("label", `${PREFIX}%`);
  if (nodesError) throw new Error(nodesError.message);

  const { data: items, error: itemsError } = await client
    .from("pm_items")
    .select("id, title, node_key")
    .like("title", `${PREFIX}%`);
  if (itemsError) throw new Error(itemsError.message);

  for (const n of nodes ?? []) console.log(`pm_nodes    ${n.display_ref}  ${JSON.stringify(n.label)}`);
  for (const i of items ?? []) console.log(`pm_items    ${JSON.stringify(i.title)}  node=${i.node_key}`);

  const total = (nodes?.length ?? 0) + (items?.length ?? 0);
  if (total === 0) {
    console.log("\nNothing to purge.");
    return;
  }
  if (!apply) {
    console.log(`\n${total} rows match. Re-run with --apply to delete.`);
    return;
  }

  for (const i of items ?? []) {
    const { error } = await client.from("pm_items").delete().eq("id", i.id);
    if (error) throw new Error(`pm_items ${i.id}: ${error.message}`);
  }
  // Nodes last: an item is addressed by its own id, so order only matters for anything
  // keyed on node_key, which the loop above has already cleared.
  for (const n of nodes ?? []) {
    for (const table of ["pm_files", "pm_items", "pm_notes", "pm_references", "pm_node_state"] as const) {
      const { error } = await client.from(table).delete().eq("node_key", n.node_key);
      if (error) throw new Error(`${table} ${n.node_key}: ${error.message}`);
    }
    const { error: linkError } = await client
      .from("pm_node_links")
      .delete()
      .or(`from_node_key.eq.${n.node_key},to_node_key.eq.${n.node_key}`);
    if (linkError) throw new Error(`pm_node_links ${n.node_key}: ${linkError.message}`);

    // Both kinds of ruling this card could have opened: its own (keyed on node_key) and
    // any wire drawn from or to it (keyed on the endpoints, with no node_key at all).
    // Leaving either behind puts an entry in the one queue Shawn works through by hand.
    const { error: rulingError } = await client.from("pm_rulings").delete().eq("node_key", n.node_key);
    if (rulingError) throw new Error(`pm_rulings ${n.node_key}: ${rulingError.message}`);
    const { error: linkRulingError } = await client
      .from("pm_rulings")
      .delete()
      .or(`from_node_key.eq.${n.node_key},to_node_key.eq.${n.node_key}`);
    if (linkRulingError) throw new Error(`pm_rulings (link) ${n.node_key}: ${linkRulingError.message}`);

    const { error } = await client.from("pm_nodes").delete().eq("node_key", n.node_key);
    if (error) throw new Error(`pm_nodes ${n.node_key}: ${error.message}`);
  }

  console.log(`\nPurged ${total} rows.`);
}

main();
