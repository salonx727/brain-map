// Removes rows the live integration tests left behind in the real project.
//
// Those tests write against the actual database (that is the point of them) but never
// delete what they create, so every run permanently adds a person, a handful of items,
// notes and references scoped to engine:E01, and several PM sub-nodes. On the map that
// shows up as test to-dos hanging off a real engine card and a row of junk nodes.
//
// Everything they create carries the marker `pm-layer-live-test-<timestamp>` (see
// pmLayer.integration.test.ts) or `canonical-live-test-`, which is the only thing that
// makes this safely reversible-by-inspection: nothing a person typed looks like that.
//
//   npx tsx --env-file=.env scripts/purge-test-rows.ts           # dry run, deletes nothing
//   npx tsx --env-file=.env scripts/purge-test-rows.ts --apply   # actually deletes
//
// node_key is deliberately not a foreign key anywhere (it also holds canonical keys like
// engine:E01, which live in a different table), so deleting a pm_nodes row cascades to
// nothing. Every dependent table is therefore cleared explicitly and BEFORE its node, or
// the rows would survive as invisible orphans.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const MARKERS = ["pm-layer-live-test-", "canonical-live-test-"];
const APPLY = process.argv.includes("--apply");

/**
 * `--reset-canonical engine:E01` drops the position and work-state rows for one canonical
 * node, returning it to its sheet coordinate and to UNTOUCHED. Separate from --apply and
 * never implied by it: these rows carry no marker, so only a human who has looked at the
 * values can say whether they are test residue or someone's actual arrangement.
 */
const RESET_INDEX = process.argv.indexOf("--reset-canonical");
const RESET_KEY = RESET_INDEX === -1 ? null : process.argv[RESET_INDEX + 1];

/** Rows matching any marker, found by scanning the column that carries the test's name. */
async function findMarked(db: SupabaseClient, table: string, column: string): Promise<{ id: string; label: string }[]> {
  const hits: { id: string; label: string }[] = [];
  for (const marker of MARKERS) {
    const { data, error } = await db.from(table).select(`id, ${column}`).like(column, `${marker}%`);
    if (error) throw new Error(`${table}.${column}: ${error.message}`);
    // The column name is a runtime string, so supabase-js cannot type the projection and
    // infers a ParserError. Widened through unknown deliberately.
    for (const row of (data ?? []) as unknown as Record<string, string>[]) hits.push({ id: row.id, label: row[column] });
  }
  return hits;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");
  const db = createClient(url, key, { auth: { persistSession: false } });

  if (RESET_KEY) {
    if (!APPLY) {
      console.log(`Would clear position + work-state for ${RESET_KEY}. Add --apply to do it.`);
      return;
    }
    const { error: posErr } = await db.from("pm_layout_positions").delete().eq("node_key", RESET_KEY);
    if (posErr) throw new Error(`pm_layout_positions: ${posErr.message}`);
    const { error: stErr } = await db.from("pm_node_state").delete().eq("node_key", RESET_KEY);
    if (stErr) throw new Error(`pm_node_state: ${stErr.message}`);
    console.log(`${RESET_KEY}: position and work-state cleared. It returns to its sheet coordinate and UNTOUCHED.`);
    return;
  }

  const items = await findMarked(db, "pm_items", "title");
  const notes = await findMarked(db, "pm_notes", "body");
  const refs = await findMarked(db, "pm_references", "label");
  const people = await findMarked(db, "pm_people", "name");
  const files = await findMarked(db, "pm_files", "file_name");

  // pm_nodes is keyed by node_key and has no `id` column at all, so it cannot go through
  // findMarked — and node_key is what every other table references anyway.
  const nodes: { id: string; label: string }[] = [];
  for (const marker of MARKERS) {
    const { data, error } = await db.from("pm_nodes").select("node_key, label").like("label", `${marker}%`);
    if (error) throw new Error(`pm_nodes: ${error.message}`);
    for (const row of data ?? []) nodes.push({ id: row.node_key as string, label: row.label as string });
  }
  const doomedKeys = nodes.map((n) => n.id);

  const dependents: Record<string, number> = {};
  if (doomedKeys.length > 0) {
    for (const [table, column] of [
      ["pm_items", "node_key"],
      ["pm_notes", "node_key"],
      ["pm_references", "node_key"],
      ["pm_files", "node_key"],
      ["pm_layout_positions", "node_key"],
      ["pm_node_state", "node_key"],
      // Every pm_nodes row opens one of these, including the ones a test created. Left
      // behind they are worse than junk cards on the map — they are entries in the one
      // queue Shawn works through by hand, for cards that no longer exist.
      ["pm_rulings", "node_key"],
    ] as const) {
      const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).in(column, doomedKeys);
      if (error) throw new Error(`${table}: ${error.message}`);
      dependents[table] = count ?? 0;
    }
    const { count: linkCount, error: linkErr } = await db
      .from("pm_node_links")
      .select("*", { count: "exact", head: true })
      .or(`from_node_key.in.(${doomedKeys.join(",")}),to_node_key.in.(${doomedKeys.join(",")})`);
    if (linkErr) throw new Error(`pm_node_links: ${linkErr.message}`);
    dependents["pm_node_links"] = linkCount ?? 0;
  }

  console.log(APPLY ? "=== PURGING ===" : "=== DRY RUN - nothing will be deleted ===");
  console.log("");
  console.log("Marked by name/title/body:");
  console.log(`  pm_people      ${people.length}`);
  console.log(`  pm_items       ${items.length}   (these hang off real cards, e.g. engine:E01)`);
  console.log(`  pm_notes       ${notes.length}`);
  console.log(`  pm_references  ${refs.length}`);
  console.log(`  pm_files       ${files.length}`);
  console.log(`  pm_nodes       ${nodes.length}`);
  console.log("");
  console.log("Rows attached to those pm_nodes (no FK cascade - cleared explicitly):");
  for (const [table, n] of Object.entries(dependents)) console.log(`  ${table.padEnd(20)} ${n}`);
  console.log("");
  const total = people.length + items.length + notes.length + refs.length + files.length + nodes.length + Object.values(dependents).reduce((a, b) => a + b, 0);
  console.log(`TOTAL ROWS: ${total}`);
  console.log("");
  console.log("Sample of what would go:");
  for (const r of [...items, ...notes, ...nodes].slice(0, 10)) console.log(`  ${r.label}`);

  // Residue the markers cannot catch. The tests also write work-state and a layout
  // position onto engine:E01 itself — a real canonical node, with no marker on the row to
  // identify it. Reported, never auto-deleted: a position on a canonical node is exactly
  // what a person arranging the map would also create, so this one needs a human to look.
  const { data: canonPos } = await db.from("pm_layout_positions").select("node_key,x,y").not("node_key", "like", "pm:%");
  const { data: canonState } = await db.from("pm_node_state").select("node_key,state").not("node_key", "like", "pm:%");
  console.log("");
  console.log("Residue on REAL canonical nodes (reported only, never deleted here):");
  for (const p of canonPos ?? []) console.log(`  position  ${p.node_key} -> (${p.x}, ${p.y})${p.x === 789 && p.y === 10 ? "   <-- matches the test's hardcoded x:789 y:10" : ""}`);
  for (const s of canonState ?? []) console.log(`  state     ${s.node_key} -> ${s.state}`);
  if ((canonPos?.length ?? 0) === 0 && (canonState?.length ?? 0) === 0) console.log("  none");

  if (!APPLY) {
    console.log("");
    console.log("Re-run with --apply to delete.");
    return;
  }

  // Dependents first, then the nodes, then the marker-named rows, then people last —
  // pm_people is referenced by created_by/updated_by on almost everything above.
  if (doomedKeys.length > 0) {
    for (const table of ["pm_items", "pm_notes", "pm_references", "pm_files", "pm_layout_positions", "pm_node_state", "pm_rulings"]) {
      const { error } = await db.from(table).delete().in("node_key", doomedKeys);
      if (error) throw new Error(`delete ${table}: ${error.message}`);
    }
    const { error: linkErr } = await db
      .from("pm_node_links")
      .delete()
      .or(`from_node_key.in.(${doomedKeys.join(",")}),to_node_key.in.(${doomedKeys.join(",")})`);
    if (linkErr) throw new Error(`delete pm_node_links: ${linkErr.message}`);
    const { error: nodeErr } = await db.from("pm_nodes").delete().in("node_key", doomedKeys);
    if (nodeErr) throw new Error(`delete pm_nodes: ${nodeErr.message}`);
  }

  for (const [table, rows] of [["pm_items", items], ["pm_notes", notes], ["pm_references", refs], ["pm_files", files]] as const) {
    if (rows.length === 0) continue;
    const { error } = await db.from(table).delete().in("id", rows.map((r) => r.id));
    if (error) throw new Error(`delete ${table}: ${error.message}`);
  }
  if (people.length > 0) {
    const { error } = await db.from("pm_people").delete().in("id", people.map((r) => r.id));
    if (error) throw new Error(`delete pm_people: ${error.message}`);
  }

  console.log("Done. Re-run without --apply to confirm nothing marked remains.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
