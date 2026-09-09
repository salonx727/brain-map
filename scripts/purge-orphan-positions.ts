// Deletes layout positions for PM cards that no longer exist.
//
// Until 2026-09-09 `deletePmNode` cleared every dependent table except this one, so every
// card ever removed through the app left its x/y behind. Nothing renders them — the map
// looks up positions by node, not the other way round — but they are rows describing
// cards that are gone, and they accumulate silently.
//
// A canonical node_key is NOT an orphan: engines are positioned here too and have no
// pm_nodes row by design. Only a pm: key that no longer resolves counts.
//
// Dry run by default; --apply to delete.
//
//   npx tsx --env-file=.env scripts/purge-orphan-positions.ts [--apply]

import { createClient } from "@supabase/supabase-js";

async function main() {
  const apply = process.argv.includes("--apply");
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: positions, error } = await db.from("pm_layout_positions").select("layout_id, node_key, x, y, updated_at");
  if (error) throw new Error(error.message);

  const { data: nodes, error: nodeError } = await db.from("pm_nodes").select("node_key");
  if (nodeError) throw new Error(nodeError.message);
  const live = new Set((nodes ?? []).map((n) => n.node_key as string));

  const orphans = (positions ?? []).filter((p) => {
    const key = p.node_key as string;
    return key.startsWith("pm:") && !live.has(key);
  });

  for (const p of orphans) console.log(`  ${p.node_key}   (${p.x}, ${p.y})   last touched ${p.updated_at}`);

  if (orphans.length === 0) {
    console.log("No orphan positions.");
    return;
  }
  if (!apply) {
    console.log(`\n${orphans.length} orphan positions. Re-run with --apply to delete.`);
    return;
  }

  for (const p of orphans) {
    const { error: delError } = await db
      .from("pm_layout_positions")
      .delete()
      .eq("layout_id", p.layout_id as string)
      .eq("node_key", p.node_key as string);
    if (delError) throw new Error(`${p.node_key}: ${delError.message}`);
  }
  console.log(`\nPurged ${orphans.length} orphan positions.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
