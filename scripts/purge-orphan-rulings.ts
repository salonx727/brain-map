// Deletes rulings whose card is gone.
//
// A ruling is a row in the one queue Shawn works through by hand. When the pm_nodes row
// behind it has been deleted — by a test's own cleanup, by a direct delete, by anything
// that did not go through pmWriter.deletePmNode — the entry stays, proposing a card
// nobody can open. That is worse than a junk card on the map, because the map is glanced
// at and the queue is worked.
//
// Dry run by default; --apply to delete.
//
//   npx tsx --env-file=.env scripts/purge-orphan-rulings.ts [--apply]

import { createClient } from "@supabase/supabase-js";

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: rulings, error } = await db.from("pm_rulings").select("*");
  if (error) throw new Error(error.message);

  const { data: pmNodes, error: nodeError } = await db.from("pm_nodes").select("node_key");
  if (nodeError) throw new Error(nodeError.message);
  const live = new Set((pmNodes ?? []).map((n) => n.node_key as string));

  // A canonical endpoint is not in pm_nodes and is not an orphan — it is the normal case
  // for a wire ruling between two engines. Only a pm: key that no longer resolves counts.
  const missing = (key: string | null) => Boolean(key && key.startsWith("pm:") && !live.has(key));

  const orphans = (rulings ?? []).filter((r) =>
    (r.kind ?? "node") === "link" ? missing(r.from_node_key) || missing(r.to_node_key) : missing(r.node_key),
  );

  for (const r of orphans) {
    const kind = r.kind ?? "node";
    const where = kind === "link" ? `${r.from_node_key} -> ${r.to_node_key}` : r.node_key;
    console.log(`  ${r.ruling_ref}  ${String(kind).padEnd(5)} ${JSON.stringify(r.label)}  ${where}`);
  }

  if (orphans.length === 0) {
    console.log("No orphan rulings.");
    return;
  }
  if (!apply) {
    console.log(`\n${orphans.length} orphan rulings. Re-run with --apply to delete.`);
    return;
  }

  const { error: delError } = await db
    .from("pm_rulings")
    .delete()
    .in("id", orphans.map((r) => r.id));
  if (delError) throw new Error(delError.message);
  console.log(`\nPurged ${orphans.length} orphan rulings.`);
}

main();
