// The first WALK write path — Shawn's ruling, 2026-09-17: plain manual upload, a staging
// tray, and three ways to place a tray image (replace an existing screen, append a new
// screen at the end, insert a screen between two others). Phase 1's walkReader.ts header
// said "there is deliberately no walkWriter.ts... so AI access is read-only has nothing to
// violate" — that held for phase 1's seed-only scope. This module exists because a human
// (never AI) now drives real uploads through it; see app/actions/walk.ts, the only caller.

import type { SupabaseClient } from "@supabase/supabase-js";
import { copyWalkImage, removeWalkImage, uploadWalkImage, walkImagePath, walkStagingPath } from "./walkStorage";
import type { WalkStagedImage } from "./types";

function toStagedImage(row: {
  id: string;
  node_id: string;
  file_name: string;
  storage_path: string;
  content_type: string | null;
  uploaded_at: string;
}): WalkStagedImage {
  return {
    id: row.id,
    nodeId: row.node_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    contentType: row.content_type,
    uploadedAt: row.uploaded_at,
  };
}

/** 1 + the highest existing version number for this screen — never reused, matching walk_image_version's immutability. */
async function nextVersionNumber(client: SupabaseClient, screenId: string): Promise<number> {
  const { data, error } = await client.from("walk_image_version").select("id").eq("screen_id", screenId);
  if (error) throw new Error(`nextVersionNumber: ${error.message}`);
  let max = 0;
  for (const row of data ?? []) {
    const m = /\.v(\d+)$/.exec(row.id as string);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

async function countScreensInFlow(client: SupabaseClient, flowId: string): Promise<number> {
  const { count, error } = await client.from("walk_screen").select("id", { count: "exact", head: true }).eq("flow_id", flowId);
  if (error) throw new Error(`countScreensInFlow: ${error.message}`);
  return count ?? 0;
}

/**
 * Every node's own WALK, not just MUSE's — Shawn, 2026-09-17: "every node and module has
 * the ability to have its own image library and walk-through." Phase 1 only ever seeded
 * MUSE's flow by fixture; every other node had zero walk_flow rows, so its UI tab could
 * only ever say "no flows are mapped" with no way to change that. This is the one missing
 * piece: a flow with no screens yet, so the tray has something to attach the first upload
 * to. start_screen stays null until createScreenAtEnd sets it from the first real screen.
 */
export async function startWalkForNode(client: SupabaseClient, input: { nodeId: string; title?: string }): Promise<{ flowId: string }> {
  // Readable and stable rather than a UUID — every screen this flow ever gets will show
  // "{flowId}.N{n}" as its own id (createScreenAtEnd etc.), so an opaque prefix here would
  // stay ugly on every single screen forever, not just this one row. One flow per node
  // from this action (the UI only offers "start" while a node has zero flows), so the
  // node's own key is collision-free without needing a random suffix.
  const flowId = `${input.nodeId.replace(/[^a-zA-Z0-9]/g, "-")}-WALK`;
  const { error } = await client.from("walk_flow").insert({ id: flowId, node_id: input.nodeId, title: input.title ?? "Walkthrough" });
  if (error) throw new Error(`startWalkForNode: ${error.message}`);
  return { flowId };
}

/**
 * Uploads a file into the tray, unassigned to any screen. `duplicate` is a warning, not a
 * block — Shawn's spec: "The upload should warn about duplicates," never refuse one, since
 * a person may legitimately re-upload the same export.
 */
export async function stageImage(
  client: SupabaseClient,
  input: { nodeId: string; fileName: string; contentType: string | null; bytes: Buffer | Blob | ArrayBuffer },
): Promise<{ staged: WalkStagedImage; duplicate: boolean }> {
  const { data: existing, error: existingError } = await client
    .from("walk_staged_image")
    .select("id")
    .eq("node_id", input.nodeId)
    .eq("file_name", input.fileName);
  if (existingError) throw new Error(`stageImage: ${existingError.message}`);
  const duplicate = (existing?.length ?? 0) > 0;

  const id = crypto.randomUUID();
  const storagePath = walkStagingPath(input.nodeId, id, input.fileName);
  await uploadWalkImage(client, storagePath, input.bytes, input.contentType);

  const { data, error } = await client
    .from("walk_staged_image")
    .insert({ id, node_id: input.nodeId, file_name: input.fileName, storage_path: storagePath, content_type: input.contentType })
    .select()
    .single();
  if (error) throw new Error(`stageImage: ${error.message}`);
  return { staged: toStagedImage(data), duplicate };
}

/** Removes a tray image without placing it — the file and the row both go, nothing else touches it. */
export async function discardStagedImage(client: SupabaseClient, stagedId: string): Promise<void> {
  const { data: staged, error: stagedError } = await client.from("walk_staged_image").select("storage_path").eq("id", stagedId).single();
  if (stagedError) throw new Error(`discardStagedImage: ${stagedError.message}`);
  await removeWalkImage(client, staged.storage_path);
  const { error } = await client.from("walk_staged_image").delete().eq("id", stagedId);
  if (error) throw new Error(`discardStagedImage: ${error.message}`);
}

/**
 * Move to an existing thumbnail: a new version, assigned right then. The old version is
 * kept (immutable, per 0016_walk.sql), and every touch point on this screen naturally
 * shows "check position" the moment current_version changes — derive.ts's V2 rule reads
 * that off placedOn vs. currentVersion, so nothing here has to flag them by hand.
 */
export async function replaceScreenImage(
  client: SupabaseClient,
  input: { nodeId: string; stagedId: string; screenId: string },
): Promise<{ versionId: string }> {
  const { data: staged, error: stagedError } = await client.from("walk_staged_image").select("*").eq("id", input.stagedId).single();
  if (stagedError || !staged) throw new Error("replaceScreenImage: staged image not found");

  const { data: screen, error: screenError } = await client.from("walk_screen").select("current_version").eq("id", input.screenId).single();
  if (screenError || !screen) throw new Error("replaceScreenImage: screen not found");
  const oldVersionId = screen.current_version as string | null;

  const n = await nextVersionNumber(client, input.screenId);
  const versionId = `${input.screenId}.v${n}`;
  const finalPath = walkImagePath(input.nodeId, input.screenId, versionId);
  await copyWalkImage(client, staged.storage_path, finalPath);

  const { error: versionError } = await client
    .from("walk_image_version")
    .insert({ id: versionId, screen_id: input.screenId, image_link: finalPath, figma_link: null });
  if (versionError) throw new Error(`replaceScreenImage: ${versionError.message}`);

  const { error: updateError } = await client.from("walk_screen").update({ current_version: versionId }).eq("id", input.screenId);
  if (updateError) throw new Error(`replaceScreenImage: ${updateError.message}`);

  await removeWalkImage(client, staged.storage_path);
  await client.from("walk_staged_image").delete().eq("id", input.stagedId);

  await client.from("walk_change_log").insert({
    node_id: input.nodeId,
    screen_id: input.screenId,
    kind: "replaced",
    old_version_id: oldVersionId,
    new_version_id: versionId,
    file_name: staged.file_name,
    detail: `${input.screenId} image replaced (${staged.file_name})`,
  });

  return { versionId };
}

/** Move to the end of the strip: a new screen at v1, unreachable until a touch point points to it (V6 "not linked" until then). */
export async function createScreenAtEnd(
  client: SupabaseClient,
  input: { nodeId: string; flowId: string; stagedId: string; title?: string },
): Promise<{ screenId: string }> {
  const { data: staged, error: stagedError } = await client.from("walk_staged_image").select("*").eq("id", input.stagedId).single();
  if (stagedError || !staged) throw new Error("createScreenAtEnd: staged image not found");

  const count = await countScreensInFlow(client, input.flowId);
  const screenId = `${input.flowId}.N${count + 1}`;

  const { error: screenError } = await client.from("walk_screen").insert({ id: screenId, flow_id: input.flowId, title: input.title ?? staged.file_name });
  if (screenError) throw new Error(`createScreenAtEnd: ${screenError.message}`);

  const versionId = `${screenId}.v1`;
  const finalPath = walkImagePath(input.nodeId, screenId, versionId);
  await copyWalkImage(client, staged.storage_path, finalPath);

  const { error: versionError } = await client
    .from("walk_image_version")
    .insert({ id: versionId, screen_id: screenId, image_link: finalPath, figma_link: null });
  if (versionError) throw new Error(`createScreenAtEnd: ${versionError.message}`);

  const { error: updateError } = await client.from("walk_screen").update({ current_version: versionId }).eq("id", screenId);
  if (updateError) throw new Error(`createScreenAtEnd: ${updateError.message}`);

  // A flow with no start_screen yet has no main path at all — mainPath() returns []
  // unconditionally (derive.ts) until one is set, which would otherwise make every
  // screen an orphan forever on a freshly started flow. The very first screen added
  // becomes the entry point; every screen after this one just appends normally.
  const { data: flow, error: flowError } = await client.from("walk_flow").select("start_screen").eq("id", input.flowId).single();
  if (flowError) throw new Error(`createScreenAtEnd: ${flowError.message}`);
  if (!flow.start_screen) {
    const { error: startError } = await client.from("walk_flow").update({ start_screen: screenId }).eq("id", input.flowId);
    if (startError) throw new Error(`createScreenAtEnd: ${startError.message}`);
  }

  await removeWalkImage(client, staged.storage_path);
  await client.from("walk_staged_image").delete().eq("id", input.stagedId);

  await client.from("walk_change_log").insert({
    node_id: input.nodeId,
    screen_id: screenId,
    kind: "new_screen",
    new_version_id: versionId,
    file_name: staged.file_name,
    detail: `${screenId} added at the end of ${input.flowId} (${staged.file_name})`,
  });

  return { screenId };
}

/**
 * Insert between two thumbnails: the new screen takes over the existing main-path touch
 * point's destination, and gets its own touch point onward to where that pointed before.
 * The new touch point is born with placedOn null — an unconfirmed, system-placed x/y — so
 * it reads "check position" (V2) until a human actually places it, same flag a stale swap
 * earns, for the same reason: nobody has confirmed this position is right yet.
 */
export async function insertScreenBetween(
  client: SupabaseClient,
  input: { nodeId: string; flowId: string; stagedId: string; afterScreenId: string; beforeScreenId: string; title?: string },
): Promise<{ screenId: string }> {
  const { data: staged, error: stagedError } = await client.from("walk_staged_image").select("*").eq("id", input.stagedId).single();
  if (stagedError || !staged) throw new Error("insertScreenBetween: staged image not found");

  const { data: tps, error: tpError } = await client
    .from("walk_touch_point")
    .select("*")
    .eq("screen_id", input.afterScreenId)
    .eq("to_screen", input.beforeScreenId);
  if (tpError) throw new Error(`insertScreenBetween: ${tpError.message}`);
  const mainTp = (tps ?? []).find((t) => t.n === 1);
  if (!mainTp) throw new Error(`insertScreenBetween: no main-path touch point from ${input.afterScreenId} to ${input.beforeScreenId}`);

  const count = await countScreensInFlow(client, input.flowId);
  const screenId = `${input.flowId}.N${count + 1}`;

  const { error: screenError } = await client.from("walk_screen").insert({ id: screenId, flow_id: input.flowId, title: input.title ?? staged.file_name });
  if (screenError) throw new Error(`insertScreenBetween: ${screenError.message}`);

  const versionId = `${screenId}.v1`;
  const finalPath = walkImagePath(input.nodeId, screenId, versionId);
  await copyWalkImage(client, staged.storage_path, finalPath);

  const { error: versionError } = await client
    .from("walk_image_version")
    .insert({ id: versionId, screen_id: screenId, image_link: finalPath, figma_link: null });
  if (versionError) throw new Error(`insertScreenBetween: ${versionError.message}`);

  const { error: updateError } = await client.from("walk_screen").update({ current_version: versionId }).eq("id", screenId);
  if (updateError) throw new Error(`insertScreenBetween: ${updateError.message}`);

  const { error: repointError } = await client.from("walk_touch_point").update({ to_screen: screenId }).eq("id", mainTp.id);
  if (repointError) throw new Error(`insertScreenBetween: ${repointError.message}`);

  const { error: newTpError } = await client.from("walk_touch_point").insert({
    id: `${screenId}.T1`,
    screen_id: screenId,
    n: 1,
    x: 50,
    y: 50,
    action: mainTp.action,
    to_screen: input.beforeScreenId,
    placed_on: null,
  });
  if (newTpError) throw new Error(`insertScreenBetween: ${newTpError.message}`);

  await removeWalkImage(client, staged.storage_path);
  await client.from("walk_staged_image").delete().eq("id", input.stagedId);

  await client.from("walk_change_log").insert({
    node_id: input.nodeId,
    screen_id: screenId,
    kind: "inserted",
    new_version_id: versionId,
    file_name: staged.file_name,
    detail: `${screenId} inserted between ${input.afterScreenId} and ${input.beforeScreenId} (${staged.file_name})`,
  });

  return { screenId };
}

/**
 * Branch from an existing screen: unlike insertScreenBetween, the source screen keeps its
 * existing next screen — this only adds a second (or third, ...) touch point off it, into
 * a brand-new screen. That's what makes it a lane rather than a longer main path; lanes()
 * already picks up any touch point with n >= 2 on a main-path screen, so no derive.ts
 * change is needed for the new lane to render once this touch point exists.
 *
 * n=1 is reserved for the main path everywhere in this app (mainTouchPoint() in derive.ts
 * picks it by that number alone) — confirmed live 2026-09-18: branching from a screen with
 * no other outgoing touch points computed "one past the highest existing n" as 1, which
 * made the branch indistinguishable from a main-path continuation (rendered in the main
 * row, labeled "(main path)"). The floor of 1 below guarantees a branch is never born as 1.
 *
 * Screen id is a composite of the branch point and a lane letter — Shawn, 2026-09-18:
 * `N3-A1` reads as "branch off screen 3" on sight, where the old flat `.N9` gave no hint a
 * screen was a branch at all. The letter counts existing branch lanes off this exact
 * screen (A, B, C...); every branchFromScreen call starts a new lane, so the screen is
 * always that lane's first — never a second screen appended after it, since there is no
 * "add to an existing lane" action today.
 */
export async function branchFromScreen(
  client: SupabaseClient,
  input: { nodeId: string; flowId: string; stagedId: string; fromScreenId: string; title?: string },
): Promise<{ screenId: string }> {
  const { data: staged, error: stagedError } = await client.from("walk_staged_image").select("*").eq("id", input.stagedId).single();
  if (stagedError || !staged) throw new Error("branchFromScreen: staged image not found");

  const { data: existingTps, error: tpError } = await client.from("walk_touch_point").select("n").eq("screen_id", input.fromScreenId);
  if (tpError) throw new Error(`branchFromScreen: ${tpError.message}`);
  const highestN = Math.max(1, ...(existingTps ?? []).map((t) => t.n as number));
  const nextN = highestN + 1;
  const branchCount = (existingTps ?? []).filter((t) => (t.n as number) >= 2).length;
  const branchLetter = String.fromCharCode(65 + branchCount);

  const mainNumberMatch = /\.N(\d+)$/.exec(input.fromScreenId);
  if (!mainNumberMatch) throw new Error(`branchFromScreen: "${input.fromScreenId}" is not a main-path screen id — branching only ever starts from one`);
  const screenId = `${input.flowId}.N${mainNumberMatch[1]}-${branchLetter}1`;

  const { error: screenError } = await client.from("walk_screen").insert({ id: screenId, flow_id: input.flowId, title: input.title ?? staged.file_name });
  if (screenError) throw new Error(`branchFromScreen: ${screenError.message}`);

  const versionId = `${screenId}.v1`;
  const finalPath = walkImagePath(input.nodeId, screenId, versionId);
  await copyWalkImage(client, staged.storage_path, finalPath);

  const { error: versionError } = await client
    .from("walk_image_version")
    .insert({ id: versionId, screen_id: screenId, image_link: finalPath, figma_link: null });
  if (versionError) throw new Error(`branchFromScreen: ${versionError.message}`);

  const { error: updateError } = await client.from("walk_screen").update({ current_version: versionId }).eq("id", screenId);
  if (updateError) throw new Error(`branchFromScreen: ${updateError.message}`);

  const { error: newTpError } = await client.from("walk_touch_point").insert({
    id: `${input.fromScreenId}.T${nextN}`,
    screen_id: input.fromScreenId,
    n: nextN,
    x: 50,
    y: 50,
    action: "Branch",
    to_screen: screenId,
    placed_on: null,
  });
  if (newTpError) throw new Error(`branchFromScreen: ${newTpError.message}`);

  await removeWalkImage(client, staged.storage_path);
  await client.from("walk_staged_image").delete().eq("id", input.stagedId);

  await client.from("walk_change_log").insert({
    node_id: input.nodeId,
    screen_id: screenId,
    kind: "branched",
    new_version_id: versionId,
    file_name: staged.file_name,
    detail: `${screenId} branched from ${input.fromScreenId} (${staged.file_name})`,
  });

  return { screenId };
}

/**
 * Removes a screen from view — a mistake, a test upload, whatever shouldn't be seen
 * anymore. Never touches walk_image_version (immutable by design, BUILD_PROMPT hard
 * constraint 10 — that stays permanent) or the screen row itself; only flips `hidden` and
 * clears the touch points that reached it, so getWalkGraphForNode stops returning it and
 * nothing is left pointing at a screen that's no longer there to point at (which would
 * otherwise surface as a V5 "broken link" instead of the screen just being gone).
 *
 * A flow's start_screen is only removable when nothing comes after it (no outgoing touch
 * points) — exactly the "uploaded one test image and never built the flow out" case this
 * exists for. flow.start_screen is cleared back to null alongside it, same state as a
 * freshly started, still-empty flow (startWalkForNode) — the next screen added becomes
 * the entry point again, same as the first time. A start_screen with real content after it
 * stays refused: detaching it would strand every screen downstream as unreachable orphans,
 * which is a worse version of the exact problem this function is for.
 */
export async function hideScreen(client: SupabaseClient, input: { nodeId: string; screenId: string }): Promise<void> {
  // Universal guard, not just the start screen — Codeman, 2026-09-18: the remove button
  // now shows on every thumbnail, not only a single dead-end flow's lone screen, so this
  // can no longer rely on the UI alone to keep someone from pulling a screen out from the
  // middle of a real flow. A screen with outgoing touch points has content after it;
  // hiding it here would delete those touch points and strand that content unreachable,
  // which is never what "remove this" meant. Only a dead end (nothing pointing onward) is
  // safe to hide with no further repair.
  const { count: outgoingCount, error: outgoingCountError } = await client
    .from("walk_touch_point")
    .select("id", { count: "exact", head: true })
    .eq("screen_id", input.screenId);
  if (outgoingCountError) throw new Error(`hideScreen: ${outgoingCountError.message}`);
  if ((outgoingCount ?? 0) > 0) {
    throw new Error(`hideScreen: ${input.screenId} has content after it — nothing removable here without breaking the rest of the flow`);
  }

  const { data: flow, error: flowError } = await client.from("walk_flow").select("id").eq("start_screen", input.screenId).maybeSingle();
  if (flowError) throw new Error(`hideScreen: ${flowError.message}`);
  if (flow) {
    const { error: clearStartError } = await client.from("walk_flow").update({ start_screen: null }).eq("id", flow.id);
    if (clearStartError) throw new Error(`hideScreen: ${clearStartError.message}`);
  }

  const { error: incomingError } = await client.from("walk_touch_point").delete().eq("to_screen", input.screenId);
  if (incomingError) throw new Error(`hideScreen: ${incomingError.message}`);

  const { error: hideError } = await client.from("walk_screen").update({ hidden: true }).eq("id", input.screenId);
  if (hideError) throw new Error(`hideScreen: ${hideError.message}`);

  await client.from("walk_change_log").insert({
    node_id: input.nodeId,
    screen_id: input.screenId,
    kind: "hidden",
    detail: `${input.screenId} removed from view`,
  });
}

/**
 * One past the highest n already on this screen, floored at 1 — n=1 is reserved for the
 * main path everywhere in this app (mainTouchPoint() in derive.ts picks it by that number
 * alone; confirmed live 2026-09-18, see branchFromScreen's own header for the incident).
 * A screen with nothing on it yet gets n=1 (it becomes the main path forward); every touch
 * point after that is a branch, whatever screen it's added from.
 */
async function nextSafeN(client: SupabaseClient, screenId: string): Promise<number> {
  const { data, error } = await client.from("walk_touch_point").select("n").eq("screen_id", screenId);
  if (error) throw new Error(`nextSafeN: ${error.message}`);
  if (!data || data.length === 0) return 1;
  return Math.max(1, ...data.map((t) => t.n as number)) + 1;
}

/**
 * Adds a touch point at an exact, human-placed position — Codeman, 2026-09-18: double-click
 * the preview image, place a new control there. placed_on is set to the screen's current
 * version immediately, never null — a human just placed this by hand, so it never earns
 * "check position" (V2) the way a system-computed default (branchFromScreen, insertScreenBetween)
 * does until confirmed.
 */
export async function createTouchPoint(
  client: SupabaseClient,
  input: { screenId: string; x: number; y: number; action: string; toScreen: string },
): Promise<{ touchPointId: string }> {
  const { data: screen, error: screenError } = await client.from("walk_screen").select("current_version").eq("id", input.screenId).single();
  if (screenError) throw new Error(`createTouchPoint: ${screenError.message}`);

  const n = await nextSafeN(client, input.screenId);
  const id = `${input.screenId}.T${n}`;
  const { error: insertError } = await client.from("walk_touch_point").insert({
    id,
    screen_id: input.screenId,
    n,
    x: input.x,
    y: input.y,
    action: input.action,
    to_screen: input.toScreen,
    placed_on: screen.current_version,
  });
  if (insertError) throw new Error(`createTouchPoint: ${insertError.message}`);
  return { touchPointId: id };
}

/**
 * Changes an existing touch point's label, destination, and/or position — never its n, the
 * one thing that decides main-path-vs-branch and must never move once assigned. Repositioning
 * (x/y both given) re-confirms placed_on against the screen's current version, the same "a
 * human just placed this" signal createTouchPoint gives a brand-new one.
 */
export async function updateTouchPoint(
  client: SupabaseClient,
  input: { touchPointId: string; x?: number; y?: number; action?: string; toScreen?: string },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.action !== undefined) patch.action = input.action;
  if (input.toScreen !== undefined) patch.to_screen = input.toScreen;
  if (input.x !== undefined && input.y !== undefined) {
    const { data: tp, error: tpError } = await client.from("walk_touch_point").select("screen_id").eq("id", input.touchPointId).single();
    if (tpError) throw new Error(`updateTouchPoint: ${tpError.message}`);
    const { data: screen, error: screenError } = await client.from("walk_screen").select("current_version").eq("id", tp.screen_id).single();
    if (screenError) throw new Error(`updateTouchPoint: ${screenError.message}`);
    patch.x = input.x;
    patch.y = input.y;
    patch.placed_on = screen.current_version;
  }
  if (Object.keys(patch).length === 0) return;

  const { error } = await client.from("walk_touch_point").update(patch).eq("id", input.touchPointId);
  if (error) throw new Error(`updateTouchPoint: ${error.message}`);
}

/** Removes a touch point — the screen it pointed at is not touched, and simply becomes unreachable from here if nothing else points to it (surfaced by validateFlow's V6, not this function's job). */
export async function deleteTouchPoint(client: SupabaseClient, touchPointId: string): Promise<void> {
  const { error } = await client.from("walk_touch_point").delete().eq("id", touchPointId);
  if (error) throw new Error(`deleteTouchPoint: ${error.message}`);
}
