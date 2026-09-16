import type { WalkFlag, WalkGraph, WalkLane, WalkScreen, WalkTouchPoint } from "./types";

/** Flows owned by one node, title order — BUILD_PROMPT.md Step 3. */
export function flowsForNode(graph: WalkGraph, nodeId: string) {
  return graph.flows.filter((f) => f.nodeId === nodeId).sort((a, b) => a.title.localeCompare(b.title));
}

function screenById(graph: WalkGraph, id: string): WalkScreen | undefined {
  return graph.screens.find((s) => s.id === id);
}

function touchPointsOf(graph: WalkGraph, screenId: string): WalkTouchPoint[] {
  return graph.touchPoints.filter((t) => t.screenId === screenId).sort((a, b) => a.n - b.n);
}

function mainTouchPoint(graph: WalkGraph, screenId: string): WalkTouchPoint | undefined {
  return touchPointsOf(graph, screenId).find((t) => t.n === 1);
}

/**
 * Start at flow.startScreen, follow n=1 until a screen has no touch points. Stops on
 * revisit rather than looping forever — a real cycle is a V4 flag, not a hang.
 */
export function mainPath(graph: WalkGraph, flowId: string): string[] {
  const flow = graph.flows.find((f) => f.id === flowId);
  if (!flow || !flow.startScreen) return [];

  const path: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = flow.startScreen;
  while (current && !seen.has(current)) {
    path.push(current);
    seen.add(current);
    const next = mainTouchPoint(graph, current);
    current = next?.toScreen;
  }
  return path;
}

/**
 * Every branch off the main path — BUILD_PROMPT.md Step 3's exact three endings. A
 * destination already in a different flow is an exit tile immediately, before any lane
 * walk starts; only a same-flow destination gets walked lane-by-lane looking for a
 * rejoin, an exit, or a dead end.
 */
export function lanes(graph: WalkGraph, flowId: string): WalkLane[] {
  const flow = graph.flows.find((f) => f.id === flowId);
  if (!flow) return [];
  const main = mainPath(graph, flowId);
  const mainSet = new Set(main);
  const result: WalkLane[] = [];

  for (const from of main) {
    const branches = touchPointsOf(graph, from).filter((t) => t.n >= 2);
    for (const branch of branches) {
      const destScreen = screenById(graph, branch.toScreen);
      if (!destScreen) continue; // broken link — surfaced by validateFlow's V5, not here

      if (destScreen.flowId !== flow.id) {
        const destFlow = graph.flows.find((f) => f.id === destScreen.flowId);
        result.push({
          from,
          screens: [],
          end: { type: "exit", flow: destScreen.flowId, screen: destScreen.id, node: destFlow?.nodeId ?? "" },
        });
        continue;
      }

      const laneScreens: string[] = [];
      const seen = new Set<string>([from]);
      let cursor: string | undefined = destScreen.id;
      let end: WalkLane["end"] = { type: "end" };
      while (cursor) {
        if (seen.has(cursor)) {
          end = { type: "end" };
          break;
        }
        if (mainSet.has(cursor)) {
          end = { type: "rejoin", screen: cursor };
          break;
        }
        const cursorScreen = screenById(graph, cursor);
        if (cursorScreen && cursorScreen.flowId !== flow.id) {
          const destFlow = graph.flows.find((f) => f.id === cursorScreen.flowId);
          end = { type: "exit", flow: cursorScreen.flowId, screen: cursorScreen.id, node: destFlow?.nodeId ?? "" };
          break;
        }
        laneScreens.push(cursor);
        seen.add(cursor);
        const next = mainTouchPoint(graph, cursor);
        if (!next) {
          end = { type: "end" };
          break;
        }
        cursor = next.toScreen;
      }
      result.push({ from, screens: laneScreens, end });
    }
  }
  return result;
}

/**
 * The screen sequence for one lane, for navigation — BUILD_PROMPT.md Step 3's "Sequence
 * for navigation": main path up to and including the branch point, then the lane's own
 * screens, then (only on a rejoin) the main path resuming from the rejoin screen onward.
 * An exit or a dead end has nothing to resume into — the next step is switching flows or
 * stopping, not continuing this sequence.
 */
export function laneSequence(graph: WalkGraph, flowId: string, lane: WalkLane): string[] {
  const main = mainPath(graph, flowId);
  const branchIdx = main.indexOf(lane.from);
  const upToBranch = branchIdx >= 0 ? main.slice(0, branchIdx + 1) : main;
  const sequence = [...upToBranch, ...lane.screens];
  if (lane.end.type === "rejoin") {
    const rejoinIdx = main.indexOf(lane.end.screen);
    if (rejoinIdx >= 0) sequence.push(...main.slice(rejoinIdx));
  }
  return sequence;
}

/**
 * V1-V5 — BUILD_PROMPT.md Step 3. Runs over the whole flow (main path + every lane),
 * not just whatever is currently on screen, so a flag surfaces the moment its cause
 * exists rather than only when a person happens to scroll to it.
 */
export function validateFlow(graph: WalkGraph, flowId: string): WalkFlag[] {
  const flags: WalkFlag[] = [];
  const flow = graph.flows.find((f) => f.id === flowId);
  if (!flow) return flags;

  const main = mainPath(graph, flowId);
  const mainSet = new Set(main);
  const flowLanes = lanes(graph, flowId);
  const laneScreenIds = new Set(flowLanes.flatMap((l) => l.screens));
  const everyScreenId = new Set([...main, ...laneScreenIds]);

  // V4 — a cycle in the main path itself: the walk revisited a screen before running out
  // of touch points. mainPath() already stops there; detect it by checking whether the
  // last screen still has a touch point pointing back into the path already built.
  const lastMain = main[main.length - 1];
  if (lastMain) {
    const loopBack = mainTouchPoint(graph, lastMain);
    if (loopBack && mainSet.has(loopBack.toScreen)) {
      flags.push({ rule: "V4", target: lastMain, reason: "cycle" });
    }
  }

  for (const screenId of everyScreenId) {
    const screen = screenById(graph, screenId);
    if (!screen) continue;

    // V3 — no current image.
    if (!screen.currentVersion) {
      flags.push({ rule: "V3", target: screenId, reason: "no image" });
    } else {
      const version = graph.imageVersions.find((v) => v.id === screen.currentVersion);
      if (!version || !version.imageLink) {
        flags.push({ rule: "V3", target: screenId, reason: "no image" });
      }
    }

    const touchPoints = touchPointsOf(graph, screenId);

    // V1 — a lane screen with more than one touch point.
    if (laneScreenIds.has(screenId) && touchPoints.length > 1) {
      flags.push({ rule: "V1", target: screenId, reason: "must become its own flow" });
    }

    for (const tp of touchPoints) {
      // V2 — placed on an image version that is no longer current.
      if (tp.placedOn && screen.currentVersion && tp.placedOn !== screen.currentVersion) {
        flags.push({
          rule: "V2",
          target: tp.id,
          reason: `check position (placed on ${tp.placedOn}, current ${screen.currentVersion})`,
        });
      }
      // V5 — points at a screen that doesn't exist.
      if (!screenById(graph, tp.toScreen)) {
        flags.push({ rule: "V5", target: tp.id, reason: "broken link" });
      }
    }
  }

  return flags;
}
