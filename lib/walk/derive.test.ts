import { describe, expect, it } from "vitest";
import { flowsForNode, laneSequence, lanes, mainPath, orphanScreens, validateFlow } from "./derive";
import type { WalkGraph } from "./types";
import fixture from "./fixtures/walk-muse-placeholder.json";

// The fixture is PLACEHOLDER DATA (its own _note says so) but its _expected block is the
// acceptance contract — ACCEPTANCE.md #23 is exactly "derivation unit tests pass against
// _expected in the fixture." camelCase the snake_case JSON once here rather than at every
// call site.
const graph: WalkGraph = {
  flows: fixture.flows.map((f) => ({ id: f.id, nodeId: f.node_id, title: f.title, startScreen: f.start_screen })),
  screens: fixture.screens.map((s) => ({ id: s.id, flowId: s.flow_id, title: s.title, currentVersion: s.current_version })),
  imageVersions: fixture.image_versions.map((v) => ({ id: v.id, screenId: v.screen_id, imageLink: v.image_link, figmaLink: v.figma_link })),
  touchPoints: fixture.touch_points.map((t) => ({
    id: t.id,
    screenId: t.screen_id,
    n: t.n,
    x: t.x,
    y: t.y,
    action: t.action,
    toScreen: t.to_screen,
    placedOn: t.placed_on,
  })),
};

const expected = fixture._expected;

describe("flowsForNode", () => {
  for (const [nodeId, flowIds] of Object.entries(expected.flowsForNode)) {
    it(`${nodeId} → [${flowIds.join(", ") || "empty"}]`, () => {
      expect(flowsForNode(graph, nodeId).map((f) => f.id)).toEqual(flowIds);
    });
  }
});

describe("mainPath", () => {
  it("MUSE main path matches the fixture", () => {
    expect(mainPath(graph, "MUSE")).toEqual(expected["MUSE.mainPath"]);
  });
});

describe("lanes", () => {
  it("MUSE's two lanes (M2's rejoin, M5's exit) match the fixture", () => {
    const found = lanes(graph, "MUSE").map((l) => ({ from: l.from, screens: l.screens, end: l.end }));
    expect(found).toEqual(expected["MUSE.lanes"]);
  });

  it("laneSequence for the M2 branch (through X1) matches the fixture", () => {
    const x1Lane = lanes(graph, "MUSE").find((l) => l.screens.includes("X1"));
    expect(x1Lane).toBeDefined();
    expect(laneSequence(graph, "MUSE", x1Lane!)).toEqual(expected["MUSE.laneSequence.X1"]);
  });
});

describe("validateFlow", () => {
  it("flags exactly what the fixture expects (V2 on M4.T1, V3 on M6)", () => {
    const flags = validateFlow(graph, "MUSE").map((f) => ({ rule: f.rule, target: f.target, reason: f.reason }));
    for (const exp of expected.flags) {
      expect(flags).toContainEqual(expect.objectContaining({ rule: exp.rule, target: exp.target }));
    }
  });

  it("V1: a second touch point on a lane screen (X1) is flagged 'must become its own flow'", () => {
    const withSecondTouchPoint: WalkGraph = {
      ...graph,
      touchPoints: [
        ...graph.touchPoints,
        { id: "X1.T2", screenId: "X1", n: 2, x: 10, y: 10, action: "extra", toScreen: "P1", placedOn: "X1.v1" },
      ],
    };
    const flags = validateFlow(withSecondTouchPoint, "MUSE");
    expect(flags).toContainEqual(expect.objectContaining({ rule: "V1", target: "X1" }));
  });

  it("V5: a touch point pointing at a missing screen is flagged 'broken link'", () => {
    const withBrokenLink: WalkGraph = {
      ...graph,
      touchPoints: [
        ...graph.touchPoints,
        { id: "M6.T1", screenId: "M6", n: 1, x: 50, y: 50, action: "dead end", toScreen: "GHOST", placedOn: null },
      ],
    };
    const flags = validateFlow(withBrokenLink, "MUSE");
    expect(flags).toContainEqual(expect.objectContaining({ rule: "V5", target: "M6.T1" }));
  });

  it("V2: a touch point never placed against any version (placedOn null) is flagged 'check position'", () => {
    const withUnplacedTouchPoint: WalkGraph = {
      flows: [{ id: "INS", nodeId: "test:insert", title: "Insert", startScreen: "A" }],
      screens: [
        { id: "A", flowId: "INS", title: "A", currentVersion: "A.v1" },
        { id: "NEW", flowId: "INS", title: "New", currentVersion: "NEW.v1" },
        { id: "B", flowId: "INS", title: "B", currentVersion: "B.v1" },
      ],
      imageVersions: [
        { id: "A.v1", screenId: "A", imageLink: "a.png", figmaLink: null },
        { id: "NEW.v1", screenId: "NEW", imageLink: "new.png", figmaLink: null },
        { id: "B.v1", screenId: "B", imageLink: "b.png", figmaLink: null },
      ],
      touchPoints: [
        { id: "A.T1", screenId: "A", n: 1, x: 50, y: 50, action: "to NEW", toScreen: "NEW", placedOn: "A.v1" },
        { id: "NEW.T1", screenId: "NEW", n: 1, x: 50, y: 50, action: "to B", toScreen: "B", placedOn: null },
      ],
    };
    expect(mainPath(withUnplacedTouchPoint, "INS")).toEqual(["A", "NEW", "B"]);
    const flags = validateFlow(withUnplacedTouchPoint, "INS");
    expect(flags).toContainEqual(expect.objectContaining({ rule: "V2", target: "NEW.T1" }));
  });

  it("V6: a screen appended at the end with no touch point pointing to it is flagged 'not linked'", () => {
    const withOrphan: WalkGraph = {
      ...graph,
      screens: [...graph.screens, { id: "M7", flowId: "MUSE", title: "Placeholder M7", currentVersion: null }],
    };
    expect(orphanScreens(withOrphan, "MUSE")).toEqual(["M7"]);
    const flags = validateFlow(withOrphan, "MUSE");
    expect(flags).toContainEqual(expect.objectContaining({ rule: "V6", target: "M7" }));
  });

  it("V4: a genuine main-path cycle (A→B→A) is flagged 'cycle', and mainPath stops rather than looping forever", () => {
    const cyclic: WalkGraph = {
      flows: [{ id: "CYCLE", nodeId: "test:cycle", title: "Cycle", startScreen: "A" }],
      screens: [
        { id: "A", flowId: "CYCLE", title: "A", currentVersion: null },
        { id: "B", flowId: "CYCLE", title: "B", currentVersion: null },
      ],
      imageVersions: [],
      touchPoints: [
        { id: "A.T1", screenId: "A", n: 1, x: 50, y: 50, action: "to B", toScreen: "B", placedOn: null },
        { id: "B.T1", screenId: "B", n: 1, x: 50, y: 50, action: "back to A", toScreen: "A", placedOn: null },
      ],
    };

    expect(mainPath(cyclic, "CYCLE")).toEqual(["A", "B"]);

    const flags = validateFlow(cyclic, "CYCLE");
    expect(flags).toContainEqual(expect.objectContaining({ rule: "V4", reason: "cycle" }));
  });
});
