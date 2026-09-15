// The local sync job. Run this on the machine that already has the local COYOTE file —
// never inside Vercel/Next.js (see publisher.ts's own header comment). Resolves the
// current COYOTE, parses it, and publishes the result to Supabase using the
// service-role credential — the only credential allowed to write canonical_* tables.
//
// Usage: npm run sync:coyote   (reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env)
//
// Exit 0 on publish or no_op. Exit 1 on rejection (validation failure or a Supabase
// error) — the previous snapshot stays active either way; this script only ever reports.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveCoyoteSource } from "../lib/coyote/resolver";
import { parseCanonicalNodes } from "../lib/coyote/parser";
import { publishSnapshot } from "../lib/canonical/publisher";
import { fetchCanonicalGraphFromSupabase } from "../lib/canonical/supabaseReader";
import { findCanonicalizedLinkRulings, getAllRulings } from "../lib/pm/rulingReader";
import { retireLinkRuling } from "../lib/pm/rulingWriter";

/**
 * Approximate count of distinct LOCK-YYMMDD-NNN ids in the raw text — informational
 * only (stored in canonical_snapshots.register_entry_count for audit context), never
 * read by validator.ts or the publish decision. Known to overcount slightly relative to
 * the file's own stated register total, same caveat coyote-index.md's generator carries.
 */
function countRegisterEntries(rawText: string): number {
  const matches = rawText.match(/LOCK-\d{6}-\d+/g) ?? [];
  return new Set(matches).size;
}

async function main(): Promise<number> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    return 1;
  }

  const resolved = await resolveCoyoteSource();
  if (!resolved.ok) {
    console.error(`Resolver failed: ${resolved.diagnostic.message}`);
    return 1;
  }

  const parsed = parseCanonicalNodes(resolved.source);
  const client = createClient(supabaseUrl, serviceRoleKey);

  // --force: republish a byte-identical COYOTE. Needed after an extractor change, which
  // alters the graph without altering the source the hash is taken over.
  const force = process.argv.includes("--force");

  const result = await publishSnapshot(
    client,
    resolved.source.text,
    resolved.source.fileName,
    countRegisterEntries(resolved.source.text),
    parsed,
    force,
  );

  console.log(`Source: ${resolved.source.fileName}`);
  const inferred = parsed.connections.filter((c) => c.evidenceClass === "inferred").length;
  console.log(
    `Parsed: ${parsed.nodes.length} nodes, ${parsed.connections.length} connections ` +
      `(${parsed.connections.length - inferred} declared, ${inferred} inferred)${force ? " (forced republish)" : ""}`,
  );
  console.log(`Result: ${JSON.stringify(result, null, 2)}`);

  if (result.kind === "rejected") return 1;

  await retireCanonicalizedWires(client);
  await dropCachedSurface(result.kind);
  return 0;
}

/**
 * The map is served from the CDN and regenerated behind it, so publishing a snapshot into
 * Supabase is no longer enough to put it on screen — the cached page has to be told it is
 * out of date. Every edit made inside the app does this from its own Server Action; a
 * publish from a terminal has no other way in, which is what /api/revalidate exists for.
 *
 * Never fails the sync. The publish above already committed, and a surface that catches up
 * within the 30-second backstop instead of instantly is a smaller problem than a sync
 * reported as failed when canon actually moved.
 */
async function dropCachedSurface(kind: string): Promise<void> {
  if (kind === "no_op") {
    console.log("Cache: left alone — nothing was published.");
    return;
  }
  const base = process.env.MAP_URL ?? "https://salonx-mind-map.vercel.app";
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    console.warn("Cache: REVALIDATE_SECRET not set — the live map will catch up within 30s on its own.");
    return;
  }
  try {
    const response = await fetch(`${base}/api/revalidate`, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
      signal: AbortSignal.timeout(10_000),
    });
    console.log(response.ok ? `Cache: dropped — ${base} will render the new snapshot on the next visit.` : `Cache: ${base} answered ${response.status}; it will catch up within 30s.`);
  } catch (err) {
    console.warn(`Cache: could not reach ${base} (${err instanceof Error ? err.message : String(err)}); it will catch up within 30s.`);
  }
}

/**
 * The wires canon has caught up with.
 *
 * This runs here, at the end of the sync, because the sync is the only moment the
 * canonical layer changes — so it is the only moment a pending wire can have become a
 * duplicate. No watcher, no poll, and above all no write side-effect inside a page render:
 * a retirement is a delete, and a delete that fires because somebody loaded a page is a
 * delete nobody can account for afterwards.
 *
 * Automatic, unlike a card retirement, because the match is exact rather than a guess —
 * see findCanonicalizedLinkRulings for the full reasoning. Failures here never fail the
 * sync: the publish already committed, and a wire that outlives its ruling by one cycle is
 * a duplicate on the map, while a sync reported as failed after a successful publish is a
 * lie about the state of canon.
 */
async function retireCanonicalizedWires(client: SupabaseClient): Promise<void> {
  try {
    const graph = await fetchCanonicalGraphFromSupabase(client);
    if (graph.sourceError) {
      console.warn(`Wire retirement skipped: ${graph.sourceError}`);
      return;
    }

    const all = await getAllRulings(client);
    const pending = all.filter((r) => r.status === "pending");
    const matched = findCanonicalizedLinkRulings(pending, graph.connections, all);

    if (matched.length === 0) {
      console.log("Wires retired: none — no pending wire matches an edge canon now carries.");
      return;
    }

    for (const ruling of matched) {
      await retireLinkRuling(client, ruling.id, "Canon carries this edge — retired automatically at sync.");
      console.log(`Retired ${ruling.rulingRef}: ${ruling.fromNodeKey} → ${(ruling.relation ?? "").toUpperCase()} → ${ruling.toNodeKey}`);
    }
    console.log(`Wires retired: ${matched.length}`);
  } catch (err) {
    console.warn(`Wire retirement failed (the publish above still stands): ${err instanceof Error ? err.message : String(err)}`);
  }
}

main().then((code) => process.exit(code));
