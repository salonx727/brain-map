/** What pm_nodes actually holds right now. Diagnostic only. */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data, error } = await client
    .from("pm_nodes")
    .select("node_key, display_ref, label, parent_node_key, created_at")
    .order("created_at", { ascending: false })
    .limit(15);

  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    console.log(`${row.display_ref.padEnd(8)} ${JSON.stringify(row.label).padEnd(28)} parent=${row.parent_node_key ?? "-"}  ${row.node_key}`);
  }
  console.log(`\n${data?.length ?? 0} rows`);
}

main();
