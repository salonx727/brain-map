// The two pieces of the wire-ruling flow that can be wrong silently.
//
// coyoteBlockForConnection is the only text this app produces that a human pastes into
// COYOTE. If it names the wrong engine's section, Shawn writes a backwards edge into canon
// and the next sync reads it back that way — the app would have caused a canon error
// through a person, which no amount of read-only discipline elsewhere would undo.
//
// findCanonicalizedLinkRulings deletes wires. A false positive removes a proposal Shawn
// never saw; a false negative leaves a duplicate on the map. The first is the one worth
// building the tests around.

import { describe, expect, it } from "vitest";
import { coyoteBlockForConnection, coyoteBlockForNode, connectionSummary } from "@/lib/pm/coyoteText";
import { findCanonicalizedLinkRulings } from "@/lib/pm/rulingReader";
import type { CanonicalConnection } from "@/lib/types/canonicalNode";
import type { ConnectionRelation, PmRuling } from "@/lib/types/pm";

function linkRuling(from: string, to: string, relation: ConnectionRelation, over: Partial<PmRuling> = {}): PmRuling {
  return {
    id: `id-${from}-${to}-${relation}`,
    rulingRef: "RUL-014",
    kind: "link",
    nodeKey: null,
    label: `${from} → ${relation} → ${to}`,
    parentNodeKey: null,
    status: "pending",
    intent: { downstream: null, reads: null, emits: null, trigger: null },
    fromNodeKey: from,
    toNodeKey: to,
    relation,
    linkId: `link-${from}-${to}`,
    submittedBy: null,
    submittedAt: "2026-09-09T00:00:00Z",
    resolvedAt: null,
    resolvedNote: null,
    ruledIntoNodeKey: null,
    ...over,
  };
}

function edge(from: string, to: string, evidence: "declared" | "inferred" = "declared"): CanonicalConnection {
  return {
    fromNodeKey: from,
    toNodeKey: to,
    type: "data_flow",
    directed: true,
    backward: false,
    evidenceClass: evidence,
    declaringCitation: "§35 fixture",
  };
}

describe("coyoteBlockForConnection", () => {
  it("writes DOWNSTREAM on the source's own section", () => {
    const block = coyoteBlockForConnection({
      fromLabel: "E10 — Tag",
      toLabel: "E04 — Signal",
      relation: "downstream",
      rulingRef: "RUL-014",
    });
    expect(block).toContain("§35 — E10 TAG");
    expect(block).toContain("DOWNSTREAM: E04 SIGNAL");
  });

  it("writes EMITS on the source's own section", () => {
    const block = coyoteBlockForConnection({
      fromLabel: "E01 — Ghost Notes",
      toLabel: "E11 — Nexus",
      relation: "emits",
      rulingRef: "RUL-015",
    });
    expect(block).toContain("§35 — E01 GHOST NOTES");
    expect(block).toContain("EMITS AT SESSION CLOSE: E11 NEXUS");
  });

  // The case the whole file exists for. READS is declared on the READER's card, naming
  // the source — so a TAG → SIGNAL reads-proposal is a line under SIGNAL, not under TAG.
  // Written the other way round, the parser produces SIGNAL → TAG on the next sync.
  it("writes READS on the TARGET's section, naming the source", () => {
    const block = coyoteBlockForConnection({
      fromLabel: "E10 — Tag",
      toLabel: "E04 — Signal",
      relation: "reads",
      rulingRef: "RUL-016",
    });
    expect(block).toContain("§35 — E04 SIGNAL");
    expect(block).toContain("READS: E10 TAG");
    expect(block).not.toContain("§35 — E10 TAG\nREADS");
  });

  it("writes TRIGGER on the engine's section, naming the intake object", () => {
    const block = coyoteBlockForConnection({
      fromLabel: "INT BOOKING",
      toLabel: "E01 — Ghost Notes",
      relation: "trigger",
      rulingRef: "RUL-017",
    });
    expect(block).toContain("§35 — E01 GHOST NOTES");
    expect(block).toContain("TRIGGER: INT BOOKING");
  });

  it("carries the ruling ref and the edge as provenance, so a pasted block can be traced back", () => {
    const block = coyoteBlockForConnection({
      fromLabel: "E10 — Tag",
      toLabel: "E04 — Signal",
      relation: "downstream",
      rulingRef: "RUL-014",
    });
    expect(block).toContain("RUL-014");
    expect(block).toContain("E10 TAG → DOWNSTREAM → E04 SIGNAL");
  });
});

describe("coyoteBlockForNode", () => {
  it("lists only the intent fields that were filled in", () => {
    const ruling = linkRuling("a", "b", "downstream", {
      kind: "node",
      nodeKey: "pm:1",
      label: "Spotlight Card",
      fromNodeKey: null,
      toNodeKey: null,
      relation: null,
      linkId: null,
      intent: { downstream: "E11 NEXUS", reads: null, emits: null, trigger: null },
    });
    const block = coyoteBlockForNode(ruling);
    expect(block).toContain("§35 — SPOTLIGHT CARD");
    expect(block).toContain("DOWNSTREAM: E11 NEXUS");
    expect(block).not.toContain("READS:");
    expect(block).not.toContain("TRIGGER:");
  });
});

describe("connectionSummary", () => {
  it("reads as the edge, in canon's own casing", () => {
    expect(connectionSummary("E10 — Tag", "downstream", "E04 — Signal")).toBe("E10 TAG → DOWNSTREAM → E04 SIGNAL");
  });

  it("phrases READS in plain English, target-reads-source, never an arrow from source to target", () => {
    // Stored/drawn source -> target is E10 -> E04, but READS means E04 reads E10's data
    // (see coyoteText.ts's header) — "E10 TAG → READS → E04 SIGNAL" would tell a reader
    // the opposite of who reads whom.
    expect(connectionSummary("E10 — Tag", "reads", "E04 — Signal")).toBe("E04 SIGNAL reads E10 TAG's data");
  });
});

describe("findCanonicalizedLinkRulings", () => {
  it("retires a pending wire once canon carries the same edge", () => {
    const pending = [linkRuling("engine:E10", "engine:E04", "downstream")];
    const matched = findCanonicalizedLinkRulings(pending, [edge("engine:E10", "engine:E04")]);
    expect(matched).toHaveLength(1);
  });

  it("leaves a wire alone when canon has the edge the other way round", () => {
    const pending = [linkRuling("engine:E10", "engine:E04", "downstream")];
    const matched = findCanonicalizedLinkRulings(pending, [edge("engine:E04", "engine:E10")]);
    expect(matched).toHaveLength(0);
  });

  // Shawn's operator, 2026-09-09: for "does canon already carry this connection", a
  // declared edge and one inferred from the target's READS do the same work.
  it("retires on an inferred edge exactly as on a declared one", () => {
    const pending = [linkRuling("engine:E10", "engine:E04", "downstream")];
    const matched = findCanonicalizedLinkRulings(pending, [edge("engine:E10", "engine:E04", "inferred")]);
    expect(matched).toHaveLength(1);
  });

  it("ignores relation — canon holds an edge, not a field", () => {
    const pending = [linkRuling("engine:E10", "engine:E04", "reads")];
    const matched = findCanonicalizedLinkRulings(pending, [edge("engine:E10", "engine:E04")]);
    expect(matched).toHaveLength(1);
  });

  it("never touches a node ruling, whatever canon holds", () => {
    const node = linkRuling("x", "y", "downstream", { kind: "node", nodeKey: "pm:1", fromNodeKey: null, toNodeKey: null, relation: null });
    expect(findCanonicalizedLinkRulings([node], [edge("engine:E10", "engine:E04")])).toHaveLength(0);
  });

  it("follows an endpoint that has itself retired into canon", () => {
    const retiredCard: PmRuling = linkRuling("a", "b", "downstream", {
      id: "card-ruling",
      kind: "node",
      nodeKey: "pm:abc",
      status: "ruled",
      fromNodeKey: null,
      toNodeKey: null,
      relation: null,
      linkId: null,
      ruledIntoNodeKey: "engine:E12",
    });
    const wire = linkRuling("pm:abc", "engine:E04", "downstream");
    const matched = findCanonicalizedLinkRulings([wire], [edge("engine:E12", "engine:E04")], [retiredCard, wire]);
    expect(matched).toHaveLength(1);
  });

  it("returns nothing when canon carries no matching edge at all", () => {
    const pending = [linkRuling("engine:E10", "engine:E04", "downstream")];
    expect(findCanonicalizedLinkRulings(pending, [])).toHaveLength(0);
  });
});
