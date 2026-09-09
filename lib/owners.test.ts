// The routing rule for work COYOTE names but attaches to no engine. Asserted here
// because the alternative to a rule is a person deciding item by item, and 123 items is
// where that stops happening.

import { describe, expect, it } from "vitest";
import { buildModel } from "@/lib/adapter";
import { unattributedFrom } from "@/lib/owners";
import { buildFullDiagnostics } from "@/lib/coyote/diagnostics";
import type { AttributedItem, Diagnostic } from "@/lib/types/canonicalNode";
import type { PmLayer, PmLayoutPosition } from "@/lib/types/pm";

const EMPTY_PM: PmLayer = { nodes: [], items: [], notes: [], references: [], files: [], links: [], states: [], rulings: [] };

function looseBlocker(text: string): Diagnostic {
  return {
    severity: "warning",
    message: `Unattributed blocker (§15): ${text}`,
    unattributed: { kind: "blocker", text, sourceSection: "§15 › Launch Blockers" },
  };
}

function looseQuestion(text: string, qId: string, status: string): Diagnostic {
  return {
    severity: "warning",
    message: `Unattributed open question (§00a): ${qId} — ${text}`,
    unattributed: { kind: "open question", text, sourceSection: "§00a", qId, status },
  };
}

describe("unattributedFrom", () => {
  it("ignores diagnostics that are not about an item", () => {
    const diagnostics: Diagnostic[] = [
      { severity: "error", message: "§15 not found in resolved COYOTE — blockers unreachable." },
      looseBlocker("fix one line in drop_engine.js"),
    ];
    expect(unattributedFrom(diagnostics).map((i) => i.text)).toEqual(["fix one line in drop_engine.js"]);
  });
});

describe("an item nothing is holding", () => {
  const attributed = (over: Partial<AttributedItem>): AttributedItem => ({
    text: "t",
    sourceSection: "§15",
    confidence: "matched",
    ...over,
  });

  it("is reported when it matched a node that cannot hold it", () => {
    // The silent case: a real match against a screen, which carries no item list. It is
    // not unattributed and it was never attached, so before `placed` it went nowhere.
    const parsed = {
      diagnostics: [],
      blockers: [attributed({ nodeKey: "screen:S1" })],
      openQuestions: [],
    };
    expect(buildFullDiagnostics(parsed)).toHaveLength(1);
  });

  it("is not reported once it is actually on a node", () => {
    const parsed = {
      diagnostics: [],
      blockers: [attributed({ nodeKey: "engine:E05", placed: true })],
      openQuestions: [],
    };
    expect(buildFullDiagnostics(parsed)).toEqual([]);
  });
});

describe("owner cards", () => {
  it("exist even when the snapshot names no loose work", () => {
    const model = buildModel([], [], EMPTY_PM, new Map(), []);
    expect(model.nodes["owner:codeman"].blockers).toEqual([]);
    expect(model.nodes["owner:shawn"].todos).toEqual([]);
  });

  it("sends a loose blocker to Codeman and a loose question to Shawn", () => {
    const model = buildModel(
      [],
      [],
      EMPTY_PM,
      new Map(),
      [looseBlocker("founder_registry table + seed"), looseQuestion("Standard catalog's baseline prices", "Q-CATALOG", "OPEN")],
    );

    expect(model.nodes["owner:codeman"].blockers.map((b) => b.text)).toEqual(["founder_registry table + seed"]);
    expect(model.nodes["owner:codeman"].todos).toEqual([]);
    expect(model.nodes["owner:shawn"].todos.map((t) => t.text)).toEqual(["Standard catalog's baseline prices"]);
    expect(model.nodes["owner:shawn"].blockers).toEqual([]);
  });

  it("carries the Q-ID and status into the citation line", () => {
    const model = buildModel([], [], EMPTY_PM, new Map(), [looseQuestion("Whether a permission resolves against a module", "Q-MODULE-PERM", "OPEN")]);
    expect(model.nodes["owner:shawn"].todos[0].sec).toBe("§00a · Q-MODULE-PERM · OPEN");
  });

  it("marks everything it places as canon, so nothing offers an edit it cannot honour", () => {
    const model = buildModel([], [], EMPTY_PM, new Map(), [looseBlocker("b"), looseQuestion("q", "Q-1", "OPEN")]);
    expect(model.nodes["owner:codeman"].blockers[0].canon).toBe(true);
    expect(model.nodes["owner:shawn"].todos[0].canon).toBe(true);
    expect(model.nodes["owner:codeman"].origin).toBe("canon");
  });

  it("closes a question the queue has already closed", () => {
    const model = buildModel([], [], EMPTY_PM, new Map(), [looseQuestion("settled", "Q-2", "CLOSED")]);
    expect(model.nodes["owner:shawn"].todos[0].done).toBe(true);
  });

  it("yields to a saved position, so dragging an owner card sticks", () => {
    const positions = new Map<string, PmLayoutPosition>([
      ["owner:shawn", { layoutId: "l1", nodeKey: "owner:shawn", x: 40, y: 90, color: null, updatedBy: null, updatedAt: "2026-09-08T00:00:00Z" }],
    ]);
    const model = buildModel([], [], EMPTY_PM, positions, []);
    expect([model.nodes["owner:shawn"].x, model.nodes["owner:shawn"].y]).toEqual([40, 90]);
    // Codeman, undragged, still sits where the sheet put him.
    expect([model.nodes["owner:codeman"].x, model.nodes["owner:codeman"].y]).toEqual([-470, 1420]);
  });
});
