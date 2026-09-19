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
import { branchFromScreen, createTouchPoint, deleteTouchPoint, hideScreen, stageImage, updateTouchPoint } from "./walkWriter";

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

  it("branching from a screen with no other touch points never lands on n=1 — confirmed live 2026-09-18, n=1 reads as the main path everywhere", async () => {
    // screenId must match branchFromScreen's own \.N(\d+)$ expectation — same shape as a
    // real main-path screen, e.g. "<flow>.N3".
    const branchFlowId = `${TEST_MARKER}-branch-flow`;
    const fromScreenId = `${branchFlowId}.N1`;
    // start_screen is a FK to walk_screen — the screen has to exist before the flow can
    // point at it, so this is flow (no start_screen yet), screen, then the update.
    const { error: flowInsertError } = await serviceClient.from("walk_flow").insert({ id: branchFlowId, node_id: "engine:E01", title: "Test flow" });
    if (flowInsertError) throw flowInsertError;
    const { error: screenInsertError } = await serviceClient.from("walk_screen").insert({ id: fromScreenId, flow_id: branchFlowId, title: "Test screen" });
    if (screenInsertError) throw screenInsertError;
    const { error: startScreenError } = await serviceClient.from("walk_flow").update({ start_screen: fromScreenId }).eq("id", branchFlowId);
    if (startScreenError) throw startScreenError;

    const { staged } = await stageImage(serviceClient, { nodeId: "engine:E01", fileName: `${TEST_MARKER}-branch.png`, contentType: "image/png", bytes: Buffer.from("x") });
    const { screenId } = await branchFromScreen(serviceClient, { nodeId: "engine:E01", flowId: branchFlowId, stagedId: staged.id, fromScreenId });

    expect(screenId).toBe(`${branchFlowId}.N1-A1`);
    const { data: tp } = await serviceClient.from("walk_touch_point").select("n").eq("screen_id", fromScreenId).eq("to_screen", screenId).single();
    expect(tp?.n).toBe(2);

    // hideScreen must refuse fromScreenId now — Codeman, 2026-09-18: the remove button
    // shows on every thumbnail, so this guard can no longer be "only the start screen with
    // outgoing touch points." fromScreenId has the branch touch point just created; hiding
    // it here would delete that touch point and strand the branch screen unreachable.
    await expect(hideScreen(serviceClient, { nodeId: "engine:E01", screenId: fromScreenId })).rejects.toThrow(/has content after it/i);

    // The branch screen itself is a dead end (nothing points onward from it) — hiding
    // that one is exactly the safe case and must still succeed.
    await hideScreen(serviceClient, { nodeId: "engine:E01", screenId });
    const { data: hiddenRow } = await serviceClient.from("walk_screen").select("hidden").eq("id", screenId).single();
    expect(hiddenRow?.hidden).toBe(true);

    // Best-effort tidy — walk_image_version is immutable (ACCEPTANCE #18 above), so the
    // version row this created, and the screen/flow rows an FK ties to it, outlive this
    // test by design; hideScreen at least keeps it out of the live UI.
    await serviceClient.from("walk_touch_point").delete().eq("screen_id", fromScreenId);
    await serviceClient.from("walk_screen").update({ hidden: true }).eq("id", fromScreenId);
  }, 20_000);

  it("manually creating a touch point via the double-click popup also lands the first one on n=1 and later ones on n=2+", async () => {
    const manualFlowId = `${TEST_MARKER}-manual-flow`;
    const screenA = `${manualFlowId}.N1`;
    const screenB = `${manualFlowId}.N2`;
    const screenC = `${manualFlowId}.N3`;
    const versionA = `${screenA}.v1`;
    await serviceClient.from("walk_flow").insert({ id: manualFlowId, node_id: "engine:E01", title: "Test flow" });
    await serviceClient.from("walk_screen").insert([
      { id: screenA, flow_id: manualFlowId, title: "A" },
      { id: screenB, flow_id: manualFlowId, title: "B" },
      { id: screenC, flow_id: manualFlowId, title: "C" },
    ]);
    await serviceClient.from("walk_image_version").insert({ id: versionA, screen_id: screenA, image_link: null, figma_link: null });
    await serviceClient.from("walk_screen").update({ current_version: versionA }).eq("id", screenA);
    await serviceClient.from("walk_flow").update({ start_screen: screenA }).eq("id", manualFlowId);

    const first = await createTouchPoint(serviceClient, { screenId: screenA, x: 40, y: 60, action: "CONTROL X", toScreen: screenB });
    const { data: firstTp } = await serviceClient.from("walk_touch_point").select("n, placed_on").eq("id", first.touchPointId).single();
    expect(firstTp?.n).toBe(1);
    expect(firstTp?.placed_on).not.toBeNull(); // human-placed, never "check position"

    const second = await createTouchPoint(serviceClient, { screenId: screenA, x: 10, y: 10, action: "Secondary", toScreen: screenC });
    const { data: secondTp } = await serviceClient.from("walk_touch_point").select("n").eq("id", second.touchPointId).single();
    expect(secondTp?.n).toBe(2);

    await updateTouchPoint(serviceClient, { touchPointId: second.touchPointId, action: "Renamed", x: 20, y: 20 });
    const { data: updated } = await serviceClient.from("walk_touch_point").select("action, x, y, n").eq("id", second.touchPointId).single();
    expect(updated?.action).toBe("Renamed");
    expect(updated?.x).toBe(20);
    expect(updated?.n).toBe(2); // n never moves on update

    await deleteTouchPoint(serviceClient, second.touchPointId);
    const { data: afterDelete } = await serviceClient.from("walk_touch_point").select("id").eq("id", second.touchPointId);
    expect(afterDelete).toEqual([]);

    // Tidy — same immutability note as the test above.
    await serviceClient.from("walk_touch_point").delete().eq("screen_id", screenA);
    await serviceClient.from("walk_flow").update({ start_screen: null }).eq("id", manualFlowId);
    await serviceClient.from("walk_screen").update({ hidden: true }).in("id", [screenA, screenB, screenC]);
  }, 20_000);
});
