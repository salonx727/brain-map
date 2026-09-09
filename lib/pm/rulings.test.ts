// The reconcile matcher, tested against the shapes labels actually take.
//
// The stakes are asymmetric and that is what these assert. A missed match costs a tap on
// a card that stays in the queue; a wrong match, if it were ever allowed to act on its
// own, would delete a card and everything attached to it. So the matcher is allowed to
// over-suggest and is never allowed to decide — every test below ends at a suggestion.

import { describe, expect, it } from "vitest";
import { findReconcileCandidates, normalizeLabel } from "@/lib/pm/rulingReader";
import type { CanonicalNode } from "@/lib/types/canonicalNode";
import type { PmRuling } from "@/lib/types/pm";

function ruling(label: string, over: Partial<PmRuling> = {}): PmRuling {
  return {
    id: `id-${label}`,
    rulingRef: "RUL-001",
    kind: "node",
    nodeKey: `pm:${label}`,
    label,
    parentNodeKey: null,
    status: "pending",
    intent: { downstream: null, reads: null, emits: null, trigger: null },
    fromNodeKey: null,
    toNodeKey: null,
    relation: null,
    linkId: null,
    submittedBy: null,
    submittedAt: "2026-09-09T00:00:00Z",
    resolvedAt: null,
    resolvedNote: null,
    ruledIntoNodeKey: null,
    ...over,
  };
}

function canonical(nodeKey: string, label: string): CanonicalNode {
  return {
    nodeKey,
    kind: "intake",
    label,
    canonRefs: [],
    sourceMeta: { fileName: "X_09-09_0900_Coyote.md", resolvedAt: "2026-09-09T16:22:47.936Z" },
    definition: { state: "empty" },
  };
}

describe("normalizeLabel", () => {
  it("ignores case and spacing, because a card is typed and a canon label is parsed", () => {
    expect(normalizeLabel("Spotlight Card")).toBe(normalizeLabel("SPOTLIGHT  CARD"));
  });

  it("drops the canonical id prefix — canon writes E12 - SPOTLIGHT, nobody types that on a card", () => {
    expect(normalizeLabel("E12 - SPOTLIGHT")).toBe(normalizeLabel("Spotlight"));
  });

  it("keeps genuinely different names apart", () => {
    expect(normalizeLabel("SPOTLIGHT")).not.toBe(normalizeLabel("SPOTLIGHT QUEUE"));
  });
});

describe("findReconcileCandidates", () => {
  it("suggests the canonical arrival that matches a pending ruling", () => {
    const out = findReconcileCandidates([ruling("SPOTLIGHT")], [canonical("engine:E12", "E12 - SPOTLIGHT")]);
    expect(out).toHaveLength(1);
    expect(out[0].matches.map((m) => m.nodeKey)).toEqual(["engine:E12"]);
  });

  it("stays silent when nothing in canon resembles the card", () => {
    expect(findReconcileCandidates([ruling("SPOTLIGHT")], [canonical("engine:E01", "E01 - GHOST NOTES")])).toEqual([]);
  });

  it("offers every match rather than picking one, when canon holds two nodes by the same name", () => {
    const out = findReconcileCandidates(
      [ruling("SPOTLIGHT")],
      [canonical("engine:E12", "SPOTLIGHT"), canonical("intake:SPOTLIGHT", "Spotlight")],
    );
    expect(out[0].matches).toHaveLength(2);
  });

  it("ignores a canonical node with no label to compare", () => {
    expect(findReconcileCandidates([ruling("SPOTLIGHT")], [canonical("engine:E12", "   ")])).toEqual([]);
  });

  it("returns the ruling itself, so the tray can name what it is asking about", () => {
    const r = ruling("SPOTLIGHT", { rulingRef: "RUL-014" });
    const out = findReconcileCandidates([r], [canonical("engine:E12", "SPOTLIGHT")]);
    expect(out[0].ruling.rulingRef).toBe("RUL-014");
  });
});
