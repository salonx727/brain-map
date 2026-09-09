// What is actually sitting in Shawn's queue, and whether each entry still has a card
// behind it. An orphan — a ruling whose pm_nodes row is gone — is the failure mode worth
// looking for: it is an entry in the one queue he works through by hand, for a card
// nobody can open.
//
//   npx tsx --env-file=.env scripts/peek-rulings.ts

import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: rulings, error } = await db.from("pm_rulings").select("*").order("submitted_at", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: nodes, error: nodeError } = await db.from("pm_nodes").select("node_key");
  if (nodeError) throw new Error(nodeError.message);
  const live = new Set((nodes ?? []).map((n) => n.node_key as string));

  for (const r of rulings ?? []) {
    const kind = r.kind ?? "node";
    const where =
      kind === "link"
        ? `${r.from_node_key} → ${r.relation} → ${r.to_node_key}`
        : `${r.node_key}${live.has(r.node_key) ? "" : "   <- ORPHAN, no pm_nodes row"}`;
    console.log(`${r.ruling_ref}  ${String(r.status).padEnd(9)} ${String(kind).padEnd(5)} ${JSON.stringify(r.label)}  ${where}`);
  }
  console.log(`\n${rulings?.length ?? 0} rulings, ${(rulings ?? []).filter((r) => r.status === "pending").length} pending.`);
}

main();
