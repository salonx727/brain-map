// Empties TO DO, per the ruling that TO DO holds only what someone typed on this surface
// and BLK holds everything COYOTE declares.
//
// Always writes every row it is about to delete to outputs/ first. These rows are not in
// COYOTE — deleting them without a copy would be the one thing this surface must never
// do, and a Supabase delete has no undo.
//
//   npx tsx --env-file=.env scripts/clear-todos.ts                 # dry run, writes nothing
//   npx tsx --env-file=.env scripts/clear-todos.ts --covered --confirm
//   npx tsx --env-file=.env scripts/clear-todos.ts --all --confirm
//
// --covered  deletes only rows whose Q-ID already renders as a BLK somewhere on the map,
//            so nothing leaves the surface that isn't still visible on it.
// --all      deletes every todo row, including the audit findings and engineering tasks
//            that have no COYOTE counterpart. The backup is the only copy after that.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getCanonicalGraph } from "../lib/graph/getCanonicalGraph";
import { getWholeBoardPmLayer } from "../lib/graph/getPmLayer";
import { buildModel } from "../lib/adapter";

const Q_ID = /\b(Q-[A-Z0-9][A-Z0-9-]*)\b/g;

function idsIn(s: string): string[] {
  return [...s.matchAll(Q_ID)].map((m) => m[1].toUpperCase());
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const scope = args.has("--all") ? "all" : "covered";
  const confirmed = args.has("--confirm");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  const client = createClient(url, key);

  const { data, error } = await client.from("pm_items").select("*").eq("kind", "todo");
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const [canonical, pm] = await Promise.all([getCanonicalGraph(), getWholeBoardPmLayer()]);
  const model = buildModel(canonical.nodes, canonical.connections, pm, new Map(), canonical.diagnostics);
  const onMap = new Set(
    Object.values(model.nodes)
      .flatMap((n) => n.blockers)
      .flatMap((b) => idsIn(`${b.text} ${b.sec}`)),
  );

  const covered = rows.filter((r) => idsIn(String(r.title)).some((id) => onMap.has(id)));
  const doomed = scope === "all" ? rows : covered;

  console.log(`todo rows in pm_items        ${rows.length}`);
  console.log(`  already rendered as BLK    ${covered.length}`);
  console.log(`  no COYOTE counterpart      ${rows.length - covered.length}`);
  console.log(`\nscope --${scope} would delete ${doomed.length} rows.`);

  if (!confirmed) {
    console.log(`\nDRY RUN — nothing written, nothing deleted. Re-run with --confirm to proceed.`);
    return;
  }
  if (!doomed.length) {
    console.log(`\nNothing to do.`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = resolve(process.cwd(), `../../outputs/pm-todos-backup-${stamp}.json`);
  await mkdir(dirname(backup), { recursive: true });
  await writeFile(backup, JSON.stringify({ scope, takenAt: new Date().toISOString(), rows: doomed }, null, 2), "utf8");
  console.log(`\nbackup written  ${backup}`);

  // Chunked because a delete with 300-odd ids in one `in()` is the same oversized
  // querystring that was timing the page out last week.
  let deleted = 0;
  const ids = doomed.map((r) => r.id as string);
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const { error: delError } = await client.from("pm_items").delete().in("id", batch);
    if (delError) throw new Error(`delete failed after ${deleted} rows (backup is on disk): ${delError.message}`);
    deleted += batch.length;
  }
  console.log(`deleted         ${deleted} rows`);

  const { count } = await client.from("pm_items").select("*", { count: "exact", head: true }).eq("kind", "todo");
  console.log(`todo rows left  ${count ?? "?"}`);
}

main();
