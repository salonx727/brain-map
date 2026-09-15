// The routing rule for work COYOTE names but attaches to no engine. Asserted here
// because the alternative to a rule is a person deciding item by item, and 123 items is
// where that stops happening.

import { describe, expect, it } from "vitest";
import { buildModel } from "@/lib/adapter";
import { defaultOwnerKey, itemFingerprint, unattributedFrom } from "@/lib/owners";
import { buildFullDiagnostics } from "@/lib/coyote/diagnostics";
import type { AttributedItem, Diagnostic, EngineNode } from "@/lib/types/canonicalNode";
import type { PmLayer, PmItem, PmLayoutPosition } from "@/lib/types/pm";

const EMPTY_PM: PmLayer = { nodes: [], items: [], notes: [], references: [], files: [], links: [], states: [], rulings: [], people: [], canonAssignments: [] };

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

  it("sends a loose blocker to Codeman and a loose question to Shawn — both as BLK, never TO DO", () => {
    const model = buildModel(
      [],
      [],
      EMPTY_PM,
      new Map(),
      [looseBlocker("founder_registry table + seed"), looseQuestion("Standard catalog's baseline prices", "Q-CATALOG", "OPEN")],
    );

    expect(model.nodes["owner:codeman"].blockers.map((b) => b.text)).toEqual(["founder_registry table + seed"]);
    expect(model.nodes["owner:codeman"].todos).toEqual([]);
    expect(model.nodes["owner:shawn"].todos).toEqual([]);
    expect(model.nodes["owner:shawn"].blockers.map((b) => b.text)).toEqual(["Standard catalog's baseline prices"]);
  });

  it("never copies a §00a question onto Shawn's TO DO — that list is typed into pm_items only", () => {
    const model = buildModel([], [], EMPTY_PM, new Map(), [looseQuestion("Whether a permission resolves against a module", "Q-MODULE-PERM", "OPEN")]);
    expect(model.nodes["owner:shawn"].todos).toEqual([]);
    expect(model.nodes["owner:shawn"].blockers.map((b) => b.text)).toEqual(["Whether a permission resolves against a module"]);
  });

  it("still puts a CLOSED §00a row on BLK — dropping it is how leftover to-dos looked sourceless", () => {
    const model = buildModel([], [], EMPTY_PM, new Map(), [looseQuestion("Whether a permission resolves against a module", "Q-MODULE-PERM", "CLOSED")]);
    expect(model.nodes["owner:shawn"].blockers[0].done).toBe(true);
    expect(model.nodes["owner:shawn"].todos).toEqual([]);
  });

  it("marks a placed blocker as canon, so nothing offers an edit it cannot honour", () => {
    const model = buildModel([], [], EMPTY_PM, new Map(), [looseBlocker("b"), looseQuestion("q", "Q-1", "OPEN")]);
    expect(model.nodes["owner:codeman"].blockers[0].canon).toBe(true);
    expect(model.nodes["owner:shawn"].blockers[0].canon).toBe(true);
    expect(model.nodes["owner:shawn"].todos).toEqual([]);
    expect(model.nodes["owner:codeman"].origin).toBe("canon");
  });

  it("honours a saved move so a line Shawn sent to Codeman stays there after a rebuild", () => {
    const question = looseQuestion("Standard catalog's baseline prices", "Q-CATALOG", "OPEN").unattributed!;
    const model = buildModel(
      [],
      [],
      {
        ...EMPTY_PM,
        canonAssignments: [
          {
            fingerprint: itemFingerprint(question),
            assignedTo: "owner:codeman",
            text: question.text,
            sourceSection: question.sourceSection,
            kind: "open question",
            updatedAt: "2026-09-13T00:00:00Z",
          },
        ],
      },
      new Map(),
      [looseQuestion("Standard catalog's baseline prices", "Q-CATALOG", "OPEN")],
    );
    expect(model.nodes["owner:shawn"].blockers).toEqual([]);
    expect(model.nodes["owner:codeman"].blockers.map((b) => b.text)).toEqual(["Standard catalog's baseline prices"]);
  });

  it("carries the parts a move is recorded against, so the card can rebuild the fingerprint", () => {
    // The row no longer ships its fingerprint — it ships §, qId and text, and MOVE
    // concatenates them at the tap. If a placed blocker ever stopped carrying all three,
    // the rebuilt fingerprint would miss the saved assignment silently and the line would
    // spring back to its default owner on the next load.
    const question = looseQuestion("Standard catalog's baseline prices", "Q-CATALOG", "OPEN");
    const model = buildModel([], [], EMPTY_PM, new Map(), [question]);
    const placed = model.nodes["owner:shawn"].blockers[0];
    expect(itemFingerprint({ sourceSection: placed.sourceSection as string, qId: placed.qId, text: placed.text })).toBe(
      itemFingerprint(question.unattributed!),
    );
  });

  it("does not copy an engine's §00a questions onto TO DO — only a pm_items row lands there", () => {
    const engine: EngineNode = {
      nodeKey: "engine:E05",
      kind: "engine",
      label: "E05 — Ramp",
      canonRefs: [{ type: "section", value: "§35.6" }],
      sourceMeta: { fileName: "fixture.md", resolvedAt: "2026-09-11T00:00:00.000Z" },
      trigger: { state: "empty" },
      reads: { state: "empty" },
      writes: { state: "empty" },
      downstream: { state: "empty" },
      emits: { state: "empty" },
      blockers: [{ text: "post_confirmed tap UI", sourceSection: "§15", confidence: "matched", nodeKey: "engine:E05" }],
      openQuestions: [
        { text: "Caption line spec", sourceSection: "§00a", confidence: "matched", nodeKey: "engine:E05", qId: "Q-RAMP-CAPTION", status: "OPEN" },
      ],
    };
    const typed: PmItem = {
      id: "item-1",
      kind: "todo",
      title: "Ship the caption line",
      detail: null,
      status: "inbox",
      waitingOn: null,
      ownerId: null,
      nodeKey: "engine:E05",
      createdBy: null,
      createdAt: "2026-09-11T00:00:00Z",
      updatedBy: null,
      updatedAt: "2026-09-11T00:00:00Z",
    };
    const model = buildModel([engine], [], { ...EMPTY_PM, items: [typed] }, new Map(), []);
    expect(model.nodes["engine:E05"].blockers.map((b) => b.text)).toEqual(["post_confirmed tap UI", "Caption line spec"]);
    expect(model.nodes["engine:E05"].todos.map((t) => t.text)).toEqual(["Ship the caption line"]);
    expect(model.nodes["engine:E05"].todos[0].canon).toBeUndefined();
    expect(model.nodes["engine:E05"].todos[0].id).toBe("item-1");
  });

  it("never shows a typed blocker — BLK is COYOTE only", () => {
    const engine: EngineNode = {
      nodeKey: "engine:E05",
      kind: "engine",
      label: "E05 — Ramp",
      canonRefs: [{ type: "section", value: "§35.6" }],
      sourceMeta: { fileName: "fixture.md", resolvedAt: "2026-09-11T00:00:00.000Z" },
      trigger: { state: "empty" },
      reads: { state: "empty" },
      writes: { state: "empty" },
      downstream: { state: "empty" },
      emits: { state: "empty" },
      blockers: [{ text: "from coyote", sourceSection: "§15", confidence: "matched", nodeKey: "engine:E05" }],
      openQuestions: [],
    };
    const typed: PmItem = {
      id: "blk-1",
      kind: "blocker",
      title: "typed leftover",
      detail: null,
      status: "inbox",
      waitingOn: null,
      ownerId: null,
      nodeKey: "engine:E05",
      createdBy: null,
      createdAt: "2026-09-11T00:00:00Z",
      updatedBy: null,
      updatedAt: "2026-09-11T00:00:00Z",
    };
    const model = buildModel([engine], [], { ...EMPTY_PM, items: [typed] }, new Map(), []);
    expect(model.nodes["engine:E05"].blockers.map((b) => b.text)).toEqual(["from coyote"]);
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

describe("default owner and fingerprint", () => {
  it("sends a blocker to Codeman and a question to Shawn", () => {
    expect(defaultOwnerKey("blocker")).toBe("owner:codeman");
    expect(defaultOwnerKey("open question")).toBe("owner:shawn");
  });

  it("fingerprints two lines apart when only the qId differs", () => {
    const a = { sourceSection: "§00a", qId: "Q-1", text: "same words" };
    const b = { sourceSection: "§00a", qId: "Q-2", text: "same words" };
    expect(itemFingerprint(a)).not.toBe(itemFingerprint(b));
  });
});
