// Imports build/fixture_muse_placeholder.json (here: lib/walk/fixtures/walk-muse-placeholder.json)
// into walk_flow/walk_screen/walk_image_version/walk_touch_point — BUILD_PROMPT.md Step 2.
// Idempotent: re-running with the same fixture changes nothing. Two things make that true
// rather than assumed:
//   - walk_image_version rows are never updated (0016_walk.sql's trigger would reject it
//     anyway) — inserted with ignoreDuplicates so a rerun skips rows that already exist.
//   - walk_flow.start_screen and walk_screen.current_version are set in separate UPDATE
//     passes, each naming only that one column, after the rows they point at already
//     exist — the initial upsert of flows/screens never includes those columns, so a
//     rerun's upsert cannot clobber a value this script itself set moments earlier.
//
// Usage: tsx --env-file=.env scripts/seed-walk-fixture.ts
//        tsx --env-file=.env scripts/seed-walk-fixture.ts --remove

import type { SupabaseClient } from "@supabase/supabase-js";
import { createPmServiceClient } from "../lib/pm/serviceClient";
import fixture from "../lib/walk/fixtures/walk-muse-placeholder.json";

/**
 * Best-effort teardown, not a guaranteed one — walk_image_version is immutable
 * (0016_walk.sql's trigger rejects DELETE the same as UPDATE, unconditionally, no
 * service-role exception), and walk_screen.id is referenced by walk_image_version.screen_id,
 * so once a screen has ANY version row — even a seeded placeholder with null links — neither
 * the screen nor its flow can ever be deleted again either, by the same FK. Touch points
 * carry no such constraint and are removed first, always. Reports what it actually managed
 * rather than pretending success — a script that swallowed these errors would be lying
 * about the one guarantee ACCEPTANCE.md #18 exists to make real.
 */
async function remove(client: SupabaseClient): Promise<number> {
  const { error: tpError, count: tpCount } = await client
    .from("walk_touch_point")
    .delete({ count: "exact" })
    .in("id", fixture.touch_points.map((t) => t.id));
  if (tpError) throw new Error(`seed-walk-fixture --remove: touch points: ${tpError.message}`);
  console.log(`Removed ${tpCount ?? 0} touch points.`);

  const { error: versionError, count: versionCount } = await client
    .from("walk_image_version")
    .delete({ count: "exact" })
    .in("id", fixture.image_versions.map((v) => v.id));
  if (versionError) {
    console.log(`walk_image_version rows kept — immutable by design (ACCEPTANCE.md #18): ${versionError.message}`);
  } else {
    console.log(`Removed ${versionCount ?? 0} image versions.`);
  }

  const { error: screenError, count: screenCount } = await client
    .from("walk_screen")
    .delete({ count: "exact" })
    .in("id", fixture.screens.map((s) => s.id));
  if (screenError) {
    console.log(`walk_screen rows kept — still referenced by their (immutable) image versions: ${screenError.message}`);
  } else {
    console.log(`Removed ${screenCount ?? 0} screens.`);
  }

  const { error: flowError, count: flowCount } = await client
    .from("walk_flow")
    .delete({ count: "exact" })
    .in("id", fixture.flows.map((f) => f.id));
  if (flowError) {
    console.log(`walk_flow rows kept — still referenced by their screens: ${flowError.message}`);
  } else {
    console.log(`Removed ${flowCount ?? 0} flows.`);
  }

  return 0;
}

async function main(): Promise<number> {
  const client = createPmServiceClient();

  if (process.argv.includes("--remove")) {
    return remove(client);
  }

  const { error: flowError } = await client
    .from("walk_flow")
    .upsert(fixture.flows.map((f) => ({ id: f.id, node_id: f.node_id, title: f.title })), { onConflict: "id" });
  if (flowError) throw new Error(`seed-walk-fixture: flows: ${flowError.message}`);

  const { error: screenError } = await client
    .from("walk_screen")
    .upsert(fixture.screens.map((s) => ({ id: s.id, flow_id: s.flow_id, title: s.title })), { onConflict: "id" });
  if (screenError) throw new Error(`seed-walk-fixture: screens: ${screenError.message}`);

  const { error: versionError } = await client
    .from("walk_image_version")
    .upsert(
      fixture.image_versions.map((v) => ({ id: v.id, screen_id: v.screen_id, image_link: v.image_link, figma_link: v.figma_link })),
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (versionError) throw new Error(`seed-walk-fixture: image versions: ${versionError.message}`);

  for (const screen of fixture.screens) {
    if (!screen.current_version) continue;
    const { error } = await client.from("walk_screen").update({ current_version: screen.current_version }).eq("id", screen.id);
    if (error) throw new Error(`seed-walk-fixture: screen ${screen.id} current_version: ${error.message}`);
  }

  for (const flow of fixture.flows) {
    if (!flow.start_screen) continue;
    const { error } = await client.from("walk_flow").update({ start_screen: flow.start_screen }).eq("id", flow.id);
    if (error) throw new Error(`seed-walk-fixture: flow ${flow.id} start_screen: ${error.message}`);
  }

  const { error: touchPointError } = await client.from("walk_touch_point").upsert(
    fixture.touch_points.map((t) => ({
      id: t.id,
      screen_id: t.screen_id,
      n: t.n,
      x: t.x,
      y: t.y,
      action: t.action,
      to_screen: t.to_screen,
      placed_on: t.placed_on,
    })),
    { onConflict: "id" },
  );
  if (touchPointError) throw new Error(`seed-walk-fixture: touch points: ${touchPointError.message}`);

  console.log(
    `Seeded ${fixture.flows.length} flows, ${fixture.screens.length} screens, ${fixture.image_versions.length} image versions, ${fixture.touch_points.length} touch points.`,
  );
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
