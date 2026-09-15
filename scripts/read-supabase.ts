// Read-only window onto the Visual Brain's database, for the CommandOS agent.
//
// The agent can answer almost anything about Salon X because the vault and the workspace
// are files and it has a filesystem. The map's state is the exception: it lives in
// Postgres, and until this existed the agent's honest answer to "what's on the map?" was
// that it could not see. It could have been handed a Supabase client, or the psql
// connection string, or told to write its own query — all of which are also a write path,
// and this agent runs with bypassPermissions.
//
// So it gets a reader instead. SELECT only, an allowlist of tables, and a row cap. There
// is no argument to this script that inserts, updates or deletes anything, which is a
// stronger promise than "the agent was asked not to".
//
//   npx tsx --env-file=.env scripts/read-supabase.ts                  — the whole board, summarised
//   npx tsx --env-file=.env scripts/read-supabase.ts pm_items         — rows from one table
//   npx tsx --env-file=.env scripts/read-supabase.ts pm_items node_key=eq.engine:E05

import { createPmServiceClient } from "../lib/pm/serviceClient";

/**
 * What may be read. Everything the map draws, and nothing else — ai_messages is
 * deliberately absent: it is a command channel into this machine, and a summarising agent
 * has no business reading instructions somebody queued for it.
 */
const READABLE = [
  "canonical_nodes",
  "canonical_connections",
  "canonical_snapshots",
  "canonical_sync_state",
  "pm_nodes",
  "pm_items",
  "pm_notes",
  "pm_references",
  "pm_files",
  "pm_node_links",
  "pm_node_state",
  "pm_layouts",
  "pm_layout_positions",
  "pm_people",
  "pm_item_assignments",
  "pm_canon_assignments",
  "pm_rulings",
] as const;

const ROW_CAP = 200;

async function summarise() {
  const client = createPmServiceClient();

  const { data: sync } = await client.from("canonical_sync_state").select("*").limit(1);
  const active = sync?.[0];
  if (active) {
    const { data: snap } = await client
      .from("canonical_snapshots")
      .select("source_filename, register_entry_count, created_at")
      .eq("id", active.active_snapshot_id)
      .maybeSingle();
    console.log(
      `active snapshot: ${snap?.source_filename ?? active.active_snapshot_id}` +
        ` — ${snap?.register_entry_count ?? "?"} register entries, published ${snap?.created_at ?? "?"}`,
    );
  } else {
    console.log("active snapshot: none — the map has never been published to");
  }

  // Scoped to the active snapshot, not counted across the whole table. canonical_nodes
  // and canonical_connections keep every published snapshot — eleven of them at the time
  // of writing — so a raw count answers "how many rows have ever been published", which
  // reads as "how big is the map" and is off by an order of magnitude. The first version
  // of this script printed the raw number, and the agent it was written for caught it.
  const activeId = active?.active_snapshot_id ?? null;
  const snapshotScoped = new Set(["canonical_nodes", "canonical_connections"]);

  for (const table of READABLE) {
    let query = client.from(table).select("*", { count: "exact", head: true });
    if (snapshotScoped.has(table) && activeId) query = query.eq("snapshot_id", activeId);
    const { count, error } = await query;
    const scope = snapshotScoped.has(table) ? " (live snapshot)" : "";
    console.log(`${table.padEnd(24)} ${error ? `unreadable — ${error.message}` : count}${scope}`);
  }

  const { data: items } = await client.from("pm_items").select("kind, status");
  const open = (items ?? []).filter((i) => i.status !== "done");
  console.log(
    `\nhand-entered work: ${open.filter((i) => i.kind === "todo").length} open to-dos, ` +
      `${open.filter((i) => i.kind === "blocker").length} open blockers`,
  );
  console.log(
    "(COYOTE's own blockers and open questions are not rows here — they are parsed from " +
      "the source at publish time and live in canonical_nodes.field_states.)",
  );
}

async function dump(table: string, filter?: string) {
  if (!(READABLE as readonly string[]).includes(table)) {
    throw new Error(`"${table}" is not readable from here. Allowed: ${READABLE.join(", ")}`);
  }

  const client = createPmServiceClient();
  let query = client.from(table).select("*").limit(ROW_CAP);
  if (filter) {
    const [column, ...rest] = filter.split("=");
    const [operator, ...valueParts] = rest.join("=").split(".");
    // PostgREST's own filter grammar rather than a second one invented here — the agent
    // is already fluent in it and a homegrown syntax would be one more thing to get wrong.
    query = query.filter(column, operator, valueParts.join("."));
  }

  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(JSON.stringify(data, null, 2));
  if (data?.length === ROW_CAP) console.log(`\n(capped at ${ROW_CAP} rows — narrow the filter for the rest)`);
}

async function main() {
  const [table, filter] = process.argv.slice(2);
  if (!table) return summarise();
  return dump(table, filter);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
