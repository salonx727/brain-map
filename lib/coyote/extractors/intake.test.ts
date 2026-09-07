import { describe, expect, it } from "vitest";
import { extractIntake } from "@/lib/coyote/extractors/intake";
import type { SourceMeta } from "@/lib/types/canonicalNode";

const sourceMeta: SourceMeta = { fileName: "fixture.md", resolvedAt: "2026-09-03T00:00:00.000Z" };

describe("extractIntake", () => {
  it("produces present nodes for INT GATE and INT BOOKING when both headings exist", () => {
    const lines = [
      "## §39 — BOOKING · AVAILABILITY & THE WAITING LIST",
      "some booking prose",
      "## §40 — THE GATE · INTAKE LAYER",
      "some gate prose",
    ];
    const { nodes, diagnostics } = extractIntake(lines, sourceMeta);
    expect(nodes).toHaveLength(2);
    expect(diagnostics).toHaveLength(0);

    const gate = nodes.find((n) => n.nodeKey === "intake:GATE");
    const booking = nodes.find((n) => n.nodeKey === "intake:BOOKING");
    expect(gate?.definition.state).toBe("present");
    expect(booking?.definition.state).toBe("present");
  });

  it("marks a node disconnected, not silently absent, when its section heading is missing", () => {
    const lines = ["## §40 — THE GATE · INTAKE LAYER", "some gate prose"];
    const { nodes, diagnostics } = extractIntake(lines, sourceMeta);

    expect(nodes).toHaveLength(2); // both nodes still exist — never dropped
    const booking = nodes.find((n) => n.nodeKey === "intake:BOOKING");
    expect(booking?.definition.state).toBe("disconnected");
    expect(diagnostics.some((d) => d.nodeKey === "intake:BOOKING" && d.severity === "error")).toBe(true);
  });

  it("never collapses disconnected into empty", () => {
    const { nodes } = extractIntake([], sourceMeta);
    for (const node of nodes) {
      expect(node.definition.state).toBe("disconnected");
      expect(node.definition.state).not.toBe("empty");
    }
  });
});
