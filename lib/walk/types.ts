/** Mirrors walk_flow — see supabase/migrations/0016_walk.sql for the authoritative shape. */
export type WalkFlow = {
  id: string;
  nodeId: string;
  title: string;
  startScreen: string | null;
};

/** Mirrors walk_screen. currentVersion is a walk_image_version id, or null (no image yet). */
export type WalkScreen = {
  id: string;
  flowId: string;
  title: string;
  currentVersion: string | null;
};

/** Mirrors walk_image_version. imageLink is a Storage object path, never a URL — see the migration's header. */
export type WalkImageVersion = {
  id: string;
  screenId: string;
  imageLink: string | null;
  figmaLink: string | null;
};

/** Mirrors walk_touch_point. n=1 is the main path; n>=2 opens a lane. */
export type WalkTouchPoint = {
  id: string;
  screenId: string;
  n: number;
  x: number;
  y: number;
  action: string;
  toScreen: string;
  placedOn: string | null;
};

/** Mirrors walk_staged_image — an uploaded file not yet placed into any flow. Shawn, 2026-09-17. */
export type WalkStagedImage = {
  id: string;
  nodeId: string;
  fileName: string;
  storagePath: string;
  contentType: string | null;
  uploadedAt: string;
};

/** Everything derive.ts needs for one node — flows plus every screen/version/touch point they could reach, including into other flows (an exit tile has to resolve the target flow's own node/title). */
export type WalkGraph = {
  flows: WalkFlow[];
  screens: WalkScreen[];
  imageVersions: WalkImageVersion[];
  touchPoints: WalkTouchPoint[];
};

export type LaneEnd =
  | { type: "end" }
  | { type: "rejoin"; screen: string }
  | { type: "exit"; flow: string; screen: string; node: string };

export type WalkLane = {
  /** The main-path screen this lane branches from. */
  from: string;
  /** The lane's own screens, in order, not including `from` or the end target. */
  screens: string[];
  end: LaneEnd;
};

export type WalkFlag =
  | { rule: "V1"; target: string; reason: string }
  | { rule: "V2"; target: string; reason: string }
  | { rule: "V3"; target: string; reason: string }
  | { rule: "V4"; target: string; reason: string }
  | { rule: "V5"; target: string; reason: string }
  | { rule: "V6"; target: string; reason: string };

/** Plain-word labels for every flag rule — Shawn, 2026-09-17: "V3" reads as "version 3"; nobody but the rule's own author knows what the code means. Shown instead of the raw rule everywhere a flag renders. */
export const WALK_FLAG_LABELS: Record<WalkFlag["rule"], string> = {
  V1: "Must become its own flow",
  V2: "Check position",
  V3: "No image",
  V4: "Cycle",
  V5: "Broken link",
  V6: "Not linked",
};
