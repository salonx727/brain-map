// Read-only. Writes live in walkWriter.ts (added 2026-09-17 for manual upload — see its
// own header) and, for phase 1's fixture data, scripts/seed-walk-fixture.ts. Both are only
// ever called from app/actions/walk.ts, same as every other write in this app (service-role
// credential, never exposed to the browser) — AI access stays read-only (spec §5) because
// nothing gives an agent a way to call either.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WalkFlow, WalkGraph, WalkImageVersion, WalkScreen, WalkStagedImage, WalkTouchPoint } from "./types";

function toFlow(row: { id: string; node_id: string; title: string; start_screen: string | null }): WalkFlow {
  return { id: row.id, nodeId: row.node_id, title: row.title, startScreen: row.start_screen };
}
function toScreen(row: { id: string; flow_id: string; title: string; current_version: string | null }): WalkScreen {
  return { id: row.id, flowId: row.flow_id, title: row.title, currentVersion: row.current_version };
}
function toVersion(row: { id: string; screen_id: string; image_link: string | null; figma_link: string | null }): WalkImageVersion {
  return { id: row.id, screenId: row.screen_id, imageLink: row.image_link, figmaLink: row.figma_link };
}
function toTouchPoint(row: { id: string; screen_id: string; n: number; x: number; y: number; action: string; to_screen: string; placed_on: string | null }): WalkTouchPoint {
  return { id: row.id, screenId: row.screen_id, n: row.n, x: row.x, y: row.y, action: row.action, toScreen: row.to_screen, placedOn: row.placed_on };
}

/**
 * Everything derive.ts needs for one node's flows, PLUS one hop into any flow an exit
 * tile reaches — an exit tile has to show the destination screen and resolve the other
 * node's name (lanes()'s own exit-tile branch), so that flow's own rows have to be in the
 * graph even though it is not one of this node's own flows.
 *
 * Empty graph (never an error) for a node with nothing mapped — ACCEPTANCE.md #25's
 * empty-node state is a normal result, not a failure this has to special-case.
 */
export async function getWalkGraphForNode(client: SupabaseClient, nodeId: string): Promise<WalkGraph> {
  const { data: ownFlows, error: flowError } = await client.from("walk_flow").select("*").eq("node_id", nodeId);
  if (flowError) throw new Error(`getWalkGraphForNode: ${flowError.message}`);
  if (!ownFlows || ownFlows.length === 0) return { flows: [], screens: [], imageVersions: [], touchPoints: [] };

  const ownFlowIds = ownFlows.map((f) => f.id);
  // Hidden screens (walkWriter.hideScreen) are excluded here, not filtered later — derive.ts
  // never learns a hidden screen existed at all, the same as if it had never been created.
  const { data: ownScreens, error: screenError } = await client.from("walk_screen").select("*").in("flow_id", ownFlowIds).eq("hidden", false);
  if (screenError) throw new Error(`getWalkGraphForNode: ${screenError.message}`);

  const { data: ownTouchPoints, error: tpError } = await client
    .from("walk_touch_point")
    .select("*")
    .in("screen_id", (ownScreens ?? []).map((s) => s.id));
  if (tpError) throw new Error(`getWalkGraphForNode: ${tpError.message}`);

  // One hop out: every screen a touch point exits to, that isn't already one of our own.
  const exitScreenIds = [...new Set((ownTouchPoints ?? []).map((t) => t.to_screen))].filter(
    (id) => !(ownScreens ?? []).some((s) => s.id === id),
  );
  let exitScreens: typeof ownScreens = [];
  let exitFlows: typeof ownFlows = [];
  if (exitScreenIds.length > 0) {
    const { data, error } = await client.from("walk_screen").select("*").in("id", exitScreenIds).eq("hidden", false);
    if (error) throw new Error(`getWalkGraphForNode: ${error.message}`);
    exitScreens = data ?? [];
    const exitFlowIds = [...new Set(exitScreens.map((s) => s.flow_id))];
    if (exitFlowIds.length > 0) {
      const { data: flowsData, error: exitFlowError } = await client.from("walk_flow").select("*").in("id", exitFlowIds);
      if (exitFlowError) throw new Error(`getWalkGraphForNode: ${exitFlowError.message}`);
      exitFlows = flowsData ?? [];
    }
  }

  const allScreens = [...(ownScreens ?? []), ...exitScreens];
  const versionIds = [...new Set(allScreens.map((s) => s.current_version).filter((v): v is string => Boolean(v)))];
  let versions: WalkImageVersion[] = [];
  if (versionIds.length > 0) {
    const { data, error } = await client.from("walk_image_version").select("*").in("id", versionIds);
    if (error) throw new Error(`getWalkGraphForNode: ${error.message}`);
    versions = (data ?? []).map(toVersion);
  }

  return {
    flows: [...ownFlows, ...exitFlows].map(toFlow),
    screens: allScreens.map(toScreen),
    imageVersions: versions,
    touchPoints: (ownTouchPoints ?? []).map(toTouchPoint),
  };
}

/** The tray for one node — every uploaded file not yet placed into a flow, oldest first. */
export async function listStagedImages(client: SupabaseClient, nodeId: string): Promise<WalkStagedImage[]> {
  const { data, error } = await client.from("walk_staged_image").select("*").eq("node_id", nodeId).order("uploaded_at", { ascending: true });
  if (error) throw new Error(`listStagedImages: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    nodeId: row.node_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    contentType: row.content_type,
    uploadedAt: row.uploaded_at,
  }));
}
