import { describe, expect, it } from "vitest";
import { validateCanonicalGraph } from "@/lib/canonical/validator";
import type { CanonicalConnection, CanonicalNode, Diagnostic, SourceMeta } from "@/lib/types/canonicalNode";

const sourceMeta: SourceMeta = { fileName: "fixture.md", resolvedAt: "2026-09-03T00:00:00.000Z" };

function node(nodeKey: string, kind: CanonicalNode["kind"] = "intake"): CanonicalNode {
  return {
    nodeKey,
    kind,
    label: nodeKey,
    canonRefs: [],
    sourceMeta,
    definition: { state: "present", value: "x" },
  } as CanonicalNode;
}

function edge(from: string, to: string, citation = "§35.2 EMITS — x", backward = false): CanonicalConnection {
  return { fromNodeKey: from, toNodeKey: to, type: "data_flow", directed: true, backward, declaringCitation: citation };
}

describe("validateCanonicalGraph", () => {
  it("accepts a well-formed graph with resolving edges and exactly one backward edge", () => {
    const nodes = [node("intake:BOOKING"), node("engine:E01", "engine")];
    const connections = [edge("intake:BOOKING", "engine:E01", "§35.2 EMITS — x", true)];
    expect(validateCanonicalGraph(nodes, connections, [])).toEqual({ ok: true });
  });

  it("accepts an empty connection list — nothing to resolve is trivially valid", () => {
    const nodes = [node("intake:GATE")];
    expect(validateCanonicalGraph(nodes, [], [])).toEqual({ ok: true });
  });

  it("rejects a malformed node key", () => {
    const result = validateCanonicalGraph([node("not-a-valid-key")], [], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes("Invalid node identity"))).toBe(true);
  });

  it("rejects duplicate node keys", () => {
    const result = validateCanonicalGraph([node("intake:GATE"), node("intake:GATE")], [], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes("Duplicate node key"))).toBe(true);
  });

  it("rejects an unknown node class", () => {
    const bad = { ...node("intake:GATE"), kind: "module" } as unknown as CanonicalNode;
    const result = validateCanonicalGraph([bad], [], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes("Unknown node class"))).toBe(true);
  });

  it("rejects an edge whose endpoint does not resolve in this candidate", () => {
    const nodes = [node("intake:BOOKING")];
    const connections = [edge("intake:BOOKING", "engine:E99")];
    const result = validateCanonicalGraph(nodes, connections, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes('"to" endpoint does not resolve'))).toBe(true);
  });

  it("rejects an edge with no declaring citation", () => {
    const nodes = [node("intake:BOOKING"), node("engine:E01", "engine")];
    const connections = [edge("intake:BOOKING", "engine:E01", "")];
    const result = validateCanonicalGraph(nodes, connections, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes("no declaring citation"))).toBe(true);
  });

  it("rejects an edge with an unrecognized type", () => {
    const nodes = [node("intake:BOOKING"), node("engine:E01", "engine")];
    const bad = { ...edge("intake:BOOKING", "engine:E01"), type: "composition" } as unknown as CanonicalConnection;
    const result = validateCanonicalGraph(nodes, [bad], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes("unknown type"))).toBe(true);
  });

  it("fails closed when a whole section is unreachable", () => {
    const diagnostics: Diagnostic[] = [{ severity: "error", nodeKey: "engine:E01", message: "§35 not found in resolved COYOTE — E01 unreachable." }];
    const result = validateCanonicalGraph([node("engine:E01", "engine")], [], diagnostics);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes("Whole section(s) unreachable"))).toBe(true);
  });

  it("rejects an empty node set — confirmed live 2026-09-03, an empty candidate must never publish over good data", () => {
    const result = validateCanonicalGraph([], [], []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes("zero nodes"))).toBe(true);
  });

  it("does NOT fail closed on a single node's per-field disconnected state — only whole-section loss blocks publish", () => {
    const nodes = [node("engine:E01", "engine")];
    const diagnostics: Diagnostic[] = [{ severity: "warning", nodeKey: "engine:E01", message: '"TRIGGER" for engine:E01 runs to the end of its section without any terminating label.' }];
    expect(validateCanonicalGraph(nodes, [], diagnostics)).toEqual({ ok: true });
  });

  it("rejects a duplicate connection — canonical_connections' real primary key has no field discriminator", () => {
    const nodes = [node("intake:BOOKING"), node("engine:E01", "engine")];
    const connections = [edge("intake:BOOKING", "engine:E01", "x", true), edge("intake:BOOKING", "engine:E01", "y")];
    const result = validateCanonicalGraph(nodes, connections, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes("Duplicate connection"))).toBe(true);
  });

  it("rejects a graph with zero backward edges when connections exist — §35.8's claim must stay checkable", () => {
    const nodes = [node("intake:BOOKING"), node("engine:E01", "engine")];
    const connections = [edge("intake:BOOKING", "engine:E01")]; // backward defaults to false
    const result = validateCanonicalGraph(nodes, connections, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes("exactly one connection marked backward"))).toBe(true);
  });

  it("rejects a graph with more than one backward edge", () => {
    const nodes = [node("intake:BOOKING"), node("engine:E01", "engine"), node("engine:E02", "engine")];
    const connections = [edge("intake:BOOKING", "engine:E01", "x", true), edge("engine:E02", "engine:E01", "y", true)];
    const result = validateCanonicalGraph(nodes, connections, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.some((d) => d.includes("exactly one connection marked backward"))).toBe(true);
  });
});
