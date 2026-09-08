/**
 * Removes PM cards still wearing their creation-default label and holding nothing.
 *
 * Matches on label AND emptiness, never label alone: a card someone deliberately named
 * "NEW CARD" and then filled would be real work. Anything with a to-do, note, reference,
 * file, recorded state or wire is reported and left alone. Dry by default.
 *
 *   npx tsx --env-file=.env scripts/purge-placeholder-cards.ts [--apply]
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_LABELS = ["NEW CARD", "NEW SUB-NODE", ""];
const CHILD_TABLES = ["pm_items", "pm_notes", "pm_references", "pm_files", "pm_node_state"] as const;

async function contentCount(client: SupabaseClient, nodeKey: string): Promise<Record<string, number>> {
  const held: Record<string, number> = {};
  for (const table of CHILD_TABLES) {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq("node_key", nodeKey);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (count) held[table] = count;
  }
  const { count: links, error: linkError } = await client
    .from("pm_node_links")
    .select("*", { count: "exact", head: true })
    .or(`from_node_key.eq.${nodeKey},to_node_key.eq.${nodeKey}`);
  if (linkError) throw new Error(`pm_node_links: ${linkError.message}`);
  if (links) held.pm_node_links = links;
  return held;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: nodes, error } = await client
    .from("pm_nodes")
    .select("node_key, display_ref, label, parent_node_key")
    .in("label", DEFAULT_LABELS);
  if (error) throw new Error(error.message);

  const empty: { nodeKey: string; displayRef: string; label: string }[] = [];
  for (const n of nodes ?? []) {
    const held = await contentCount(client, n.node_key);
    const summary = Object.entries(held).map(([t, c]) => `${t}=${c}`).join(" ");
    if (summary) {
      console.log(`KEEP    ${n.display_ref.padEnd(8)} ${JSON.stringify(n.label).padEnd(16)} holds ${summary}`);
    } else {
      console.log(`PURGE   ${n.display_ref.padEnd(8)} ${JSON.stringify(n.label).padEnd(16)} empty · parent=${n.parent_node_key ?? "-"}`);
      empty.push({ nodeKey: n.node_key, displayRef: n.display_ref, label: n.label });
    }
  }

  if (empty.length === 0) {
    console.log("\nNothing to purge.");
    return;
  }
  if (!apply) {
    console.log(`\n${empty.length} empty placeholder cards. Re-run with --apply to delete.`);
    return;
  }

  for (const n of empty) {
    const { error: delError } = await client.from("pm_nodes").delete().eq("node_key", n.nodeKey);
    if (delError) throw new Error(`pm_nodes ${n.nodeKey}: ${delError.message}`);
  }
  console.log(`\nPurged ${empty.length} empty placeholder cards.`);
}

main();
