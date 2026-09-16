// Live-project integration test for WALK's DB layer — same shape as
// lib/pm/pmLayer.integration.test.ts: skipped entirely unless SUPABASE_URL,
// SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are all set. Covers ACCEPTANCE.md
// #18 (immutable image versions) and #26 (node_id required) — the two acceptance items
// that are properties of the database itself, not of derive.ts's pure functions.
//
// Also skipped — separately from the credentials check — until 0016_walk.sql is actually
// applied. That migration needs DATABASE_URL (the Postgres superuser string, never stored
// in this repo — see scripts/apply-migration.mjs's own header), which this session did
// not have, so this file was written and left ready rather than run. The probe below
// makes that self-correcting: the moment the migration lands, this suite starts running
// for real on the next `npm test`, with nobody having to remember to flip a flag.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCreds = Boolean(supabaseUrl && anonKey && serviceKey);

let tablesExist = false;
if (hasCreds) {
  const probe = createClient(supabaseUrl as string, serviceKey as string);
  const { error } = await probe.from("walk_flow").select("id").limit(1);
  tablesExist = !error;
}

describe.skipIf(!hasCreds || !tablesExist)("live WALK layer", () => {
  const serviceClient = createClient(supabaseUrl ?? "https://placeholder.supabase.co", serviceKey ?? "placeholder");
  const anonClient = createClient(supabaseUrl ?? "https://placeholder.supabase.co", anonKey ?? "placeholder");
  const TEST_MARKER = `walk-layer-live-test-${Date.now()}`;
  const flowId = `${TEST_MARKER}-flow`;
  const screenId = `${TEST_MARKER}-screen`;
  const versionId = `${TEST_MARKER}-v1`;

  beforeAll(async () => {
    await serviceClient.from("walk_flow").insert({ id: flowId, node_id: "engine:E01", title: "Test flow" });
    await serviceClient.from("walk_screen").insert({ id: screenId, flow_id: flowId, title: "Test screen" });
    await serviceClient.from("walk_image_version").insert({ id: versionId, screen_id: screenId, image_link: null, figma_link: null });
  });

  afterAll(async () => {
    await serviceClient.from("walk_image_version").delete().eq("id", versionId);
    await serviceClient.from("walk_screen").delete().eq("id", screenId);
    await serviceClient.from("walk_flow").delete().eq("id", flowId);
  });

  it("ACCEPTANCE #18: UPDATE on walk_image_version is rejected", async () => {
    const { error } = await serviceClient.from("walk_image_version").update({ image_link: "walk/x/y/z.png" }).eq("id", versionId);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/immutable/i);
  }, 20_000);

  it("ACCEPTANCE #18: DELETE on walk_image_version is rejected", async () => {
    const { error } = await serviceClient.from("walk_image_version").delete().eq("id", versionId);
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/immutable/i);
  }, 20_000);

  it("ACCEPTANCE #26: walk_flow.node_id is required — a flow without it is rejected", async () => {
    const { error } = await serviceClient.from("walk_flow").insert({ id: `${TEST_MARKER}-noflow`, title: "No node" } as never);
    expect(error).not.toBeNull();
  }, 20_000);

  it("anon can read WALK rows but cannot write them", async () => {
    const { data, error } = await anonClient.from("walk_flow").select("*").eq("id", flowId);
    expect(error).toBeNull();
    expect(data?.some((f) => f.id === flowId)).toBe(true);

    const { error: writeError } = await anonClient.from("walk_flow").insert({ id: `${TEST_MARKER}-anon`, node_id: "engine:E01", title: "Should fail" });
    expect(writeError).not.toBeNull();
  }, 20_000);
});
