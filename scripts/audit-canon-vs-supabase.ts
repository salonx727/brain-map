// Does what Supabase holds still equal what COYOTE says?
//
// Read-only, and deliberately not a test: it parses the CURRENT COYOTE from disk and diffs
// it against the ACTIVE published snapshot, node for node and edge for edge. Those two can
// drift apart in one direction only — canon moves, the snapshot does not, until somebody
// runs the sync. So a difference here is never "the database is wrong"; it is "the sync is
// overdue", and the fix is `npm run sync:coyote`, never an edit to a canonical table.
//
// It also reports the PM layer's own count alongside, because that is the number a person
// actually asks about: how much of what is on the map is NOT in canon and therefore owes
// Shawn a ruling.
//
//   npx tsx --env-file=.env scripts/audit-canon-vs-supabase.ts

import { createClient } from "@supabase/supabase-js";
import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";

function edgeKey(from: string, to: string): string {
  return `${from} -> ${to}`;
}

function tally<T>(rows: T[], of: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = of(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function line(label: string, value: string | number) {
  console.log(`  ${label.padEnd(26)} ${value}`);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY must be set");
  const db = createClient(url, key, { auth: { persistSession: false } });

  // ---- what COYOTE says, parsed fresh off disk right now ----
  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) throw new Error(`resolver failed: ${resolved.diagnostic.message}`);
  const parsed = parseCanonicalNodes(resolved.source);

  console.log("COYOTE (parsed from disk)");
  line("file", resolved.source.fileName);
  line("nodes", parsed.nodes.length);
  for (const [kind, n] of Object.entries(tally(parsed.nodes, (x) => x.kind))) line(`  ${kind}`, n);
  line("connections", parsed.connections.length);
  for (const [ev, n] of Object.entries(tally(parsed.connections, (x) => x.evidenceClass))) line(`  ${ev}`, n);

  // ---- what Supabase actually serves ----
  const { data: state, error: stateErr } = await db
    .from("canonical_sync_state")
    .select("active_snapshot_id, source_filename, register_entry_count, sync_status, synced_at")
    .eq("id", true)
    .single();
  if (stateErr) throw new Error(`canonical_sync_state: ${stateErr.message}`);
  const snapshotId = state.active_snapshot_id as string | null;
  if (!snapshotId) {
    console.log("\nSupabase: no active snapshot. Run: npm run sync:coyote");
    return;
  }

  const [{ data: nodeRows, error: nErr }, { data: edgeRows, error: eErr }] = await Promise.all([
    db.from("canonical_nodes").select("node_key, kind, label").eq("snapshot_id", snapshotId),
    db.from("canonical_connections").select("from_node_key, to_node_key, evidence_class, backward").eq("snapshot_id", snapshotId),
  ]);
  if (nErr) throw new Error(`canonical_nodes: ${nErr.message}`);
  if (eErr) throw new Error(`canonical_connections: ${eErr.message}`);

  console.log("\nSupabase (active snapshot)");
  line("published from", state.source_filename);
  line("synced at", String(state.synced_at));
  line("status", String(state.sync_status));
  line("register entries", String(state.register_entry_count));
  line("nodes", (nodeRows ?? []).length);
  for (const [kind, n] of Object.entries(tally(nodeRows ?? [], (x) => x.kind as string))) line(`  ${kind}`, n);
  line("connections", (edgeRows ?? []).length);
  for (const [ev, n] of Object.entries(tally(edgeRows ?? [], (x) => (x.evidence_class as string) ?? "(null)"))) line(`  ${ev}`, n);

  // Named, not just counted. An inferred edge is one no engine declares — it exists only
  // because the target's own READS names the source, so it is the set most worth being
  // able to eyeball against §35 by hand.
  const inferred = (edgeRows ?? []).filter((r) => r.evidence_class === "inferred");
  if (inferred.length > 0) {
    console.log("  inferred edges (no DOWNSTREAM declares them; read out of the target's READS):");
    for (const r of inferred) console.log(`      ${r.from_node_key} -> ${r.to_node_key}`);
  }

  // ---- the diff ----
  const coyoteNodes = new Set(parsed.nodes.map((n) => n.nodeKey));
  const dbNodes = new Set((nodeRows ?? []).map((n) => n.node_key as string));
  const nodesMissing = [...coyoteNodes].filter((k) => !dbNodes.has(k));
  const nodesExtra = [...dbNodes].filter((k) => !coyoteNodes.has(k));

  const coyoteEdges = new Map(parsed.connections.map((c) => [edgeKey(c.fromNodeKey, c.toNodeKey), c.evidenceClass]));
  const dbEdges = new Map((edgeRows ?? []).map((r) => [edgeKey(r.from_node_key as string, r.to_node_key as string), r.evidence_class as string]));
  const edgesMissing = [...coyoteEdges.keys()].filter((k) => !dbEdges.has(k));
  const edgesExtra = [...dbEdges.keys()].filter((k) => !coyoteEdges.has(k));
  const evidenceDrift = [...coyoteEdges.entries()].filter(([k, ev]) => dbEdges.has(k) && dbEdges.get(k) !== ev);

  console.log("\nDIFF — COYOTE vs the published snapshot");
  line("nodes in COYOTE only", nodesMissing.length);
  for (const k of nodesMissing) console.log(`      ${k}`);
  line("nodes in Supabase only", nodesExtra.length);
  for (const k of nodesExtra) console.log(`      ${k}`);
  line("edges in COYOTE only", edgesMissing.length);
  for (const k of edgesMissing) console.log(`      ${k}   (${coyoteEdges.get(k)})`);
  line("edges in Supabase only", edgesExtra.length);
  for (const k of edgesExtra) console.log(`      ${k}   (${dbEdges.get(k)})`);
  line("evidence disagrees", evidenceDrift.length);
  for (const [k, ev] of evidenceDrift) console.log(`      ${k}   COYOTE=${ev}  db=${dbEdges.get(k)}`);

  const clean =
    nodesMissing.length === 0 && nodesExtra.length === 0 && edgesMissing.length === 0 && edgesExtra.length === 0 && evidenceDrift.length === 0;
  console.log(clean ? "\n  IN SYNC — the snapshot is exactly what this COYOTE parses to." : "\n  OUT OF SYNC — run: npm run sync:coyote");

  // ---- the PM layer, which is the part that owes Shawn a ruling ----
  const [{ data: pmNodes }, { data: pmLinks }, { data: rulings }] = await Promise.all([
    db.from("pm_nodes").select("node_key, label"),
    db.from("pm_node_links").select("id, from_node_key, to_node_key, relation"),
    db.from("pm_rulings").select("id, kind, status, node_key, link_id"),
  ]);

  const pending = (rulings ?? []).filter((r) => r.status === "pending");
  console.log("\nPM layer (on the map, not in canon)");
  line("pm cards", (pmNodes ?? []).length);
  line("pm wires", (pmLinks ?? []).length);
  line("  typed (relation set)", (pmLinks ?? []).filter((l) => l.relation).length);
  line("  untyped (pre-0010)", (pmLinks ?? []).filter((l) => !l.relation).length);
  line("rulings pending", pending.length);
  line("  card rulings", pending.filter((r) => (r.kind ?? "node") === "node").length);
  line("  wire rulings", pending.filter((r) => r.kind === "link").length);

  // The gap worth naming, and it is narrower than "every wire without a ruling".
  //
  // An UNTYPED wire asserts nothing about §35 — it is the containment wire a card is born
  // with under "ADD A CARD · WIRED TO THIS ONE", drawing rather than architecture, and the
  // card at its end already carries its own ruling. Queueing those would put four entries
  // in front of Shawn that say nothing he has not already been asked.
  //
  // A TYPED wire with no open ruling is the real hole: somebody asserted a §35 relation and
  // nobody was asked about it.
  const ruledLinkIds = new Set((rulings ?? []).map((r) => (r as { link_id?: string }).link_id).filter(Boolean));
  const unruledTyped = (pmLinks ?? []).filter((l) => l.relation && !ruledLinkIds.has(l.id as string));
  if (unruledTyped.length > 0) {
    console.log(`\n  ${unruledTyped.length} TYPED PM wires carry no ruling — each is an unasked §35 assertion:`);
    for (const l of unruledTyped) console.log(`      ${l.from_node_key} -> ${l.to_node_key}   relation=${l.relation}`);
  } else {
    console.log("\n  Every typed wire has a ruling; the untyped ones are containment, which owes none.");
  }

  const unruledCards = (pmNodes ?? []).filter(
    (n) => !(rulings ?? []).some((r) => r.status === "pending" && (r as { node_key?: string }).node_key === n.node_key),
  );
  if (unruledCards.length > 0) {
    console.log(`\n  ${unruledCards.length} PM cards carry no pending ruling (ruled, rejected, or missed):`);
    for (const n of unruledCards) console.log(`      ${n.node_key}   ${JSON.stringify(n.label)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
