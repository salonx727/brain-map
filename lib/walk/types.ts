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
  | { rule: "V5"; target: string; reason: string };
