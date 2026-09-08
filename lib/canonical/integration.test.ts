// Runs the real resolver -> parser -> validator pipeline against whatever COYOTE is
// actually resolved on this machine right now (X_09-03_1200_Coyote.md, 379 entries, at
// time of writing). Unlike the fixture-based unit tests elsewhere, this is the one test
// that would fail if the registry fix regressed against real canon text — e.g. if §39/§40
// headings ever stop matching the exact regex extractIntake relies on.

import { describe, expect, it } from "vitest";
import { resolveCoyoteSource } from "@/lib/coyote/resolver";
import { parseCanonicalNodes } from "@/lib/coyote/parser";
import { validateCanonicalGraph } from "@/lib/canonical/validator";

describe("real COYOTE end-to-end (resolver -> parser -> validator)", () => {
  it("resolves a current COYOTE file on this machine", async () => {
    const result = await resolveCoyoteSource();
    expect(result.ok).toBe(true);
  });

  it("produces INT GATE and INT BOOKING as present (not disconnected) nodes against real canon", async () => {
    const result = await resolveCoyoteSource();
    if (!result.ok) throw new Error(result.diagnostic.message);
    const { nodes } = parseCanonicalNodes(result.source);

    const gate = nodes.find((n) => n.nodeKey === "intake:GATE");
    const booking = nodes.find((n) => n.nodeKey === "intake:BOOKING");
    expect(gate).toBeDefined();
    expect(booking).toBeDefined();
    expect(gate && "definition" in gate ? gate.definition.state : undefined).toBe("present");
    expect(booking && "definition" in booking ? booking.definition.state : undefined).toBe("present");
  });

  it("produces all 11 engines and 6 screens as present, matching the registry", async () => {
    const result = await resolveCoyoteSource();
    if (!result.ok) throw new Error(result.diagnostic.message);
    const { nodes } = parseCanonicalNodes(result.source);
    expect(nodes.filter((n) => n.kind === "engine")).toHaveLength(11);
    expect(nodes.filter((n) => n.kind === "screen")).toHaveLength(6);
    expect(nodes.filter((n) => n.kind === "intake")).toHaveLength(2);
  });

  it("passes validation end-to-end against real canon", async () => {
    const result = await resolveCoyoteSource();
    if (!result.ok) throw new Error(result.diagnostic.message);
    const parsed = parseCanonicalNodes(result.source);
    const verdict = validateCanonicalGraph(parsed.nodes, parsed.connections, parsed.diagnostics);
    expect(verdict).toEqual({ ok: true });
  });

  /**
   * Work-order test (Joe Offgrid, 2026-09-08, item 3): fail the build on an empty or
   * incomplete edge set, so a regression here is caught here — not found by eye weeks
   * later staring at a blank map, which is how the original gap was found.
   *
   * The work order's own expectation was 21 connections. This extractor now produces 22,
   * read from four declared fields rather than one: DOWNSTREAM, §35.2's EMITS AT SESSION
   * CLOSE table, READS (as an inbound edge) and TRIGGER (from an intake object), plus the
   * one edge canon names explicitly as an exception (§35.8's backward edge). It is still
   * only ever declared fields — never cross-engine prose mentions, which is the
   * unreliable-without-a-cross-check approach the Aug 30 SPINE audit flagged.
   *
   * The count exceeds the work order's 21 rather than matching it because canon declares
   * an edge the hand-transcribed sheet missed (E07 -> E11). Getting here needed two
   * things the narrower version lacked: EMITS captured as a field at all — E01 has no
   * DOWNSTREAM label, so the busiest node in the architecture parsed to zero outgoing
   * edges — and the capitalisation rule in matchesAsObject, which is what makes TRIGGER
   * safe to read. §35.8 E07's TRIGGER says "booking off a Cube share", a lowercase common
   * noun; §35.2 E01's says "Booking created", the object. Canon is consistent about that
   * difference, so requiring a capital separates them exactly — a case-insensitive match
   * invents an edge here, a case-sensitive one misses the real one.
   */
  it("produces exactly 22 connections against real canon, all endpoints resolved, exactly one marked backward", async () => {
    const result = await resolveCoyoteSource();
    if (!result.ok) throw new Error(result.diagnostic.message);
    const parsed = parseCanonicalNodes(result.source);

    expect(parsed.connections.length).toBe(22);

    const nodeKeys = new Set(parsed.nodes.map((n) => n.nodeKey));
    for (const conn of parsed.connections) {
      expect(nodeKeys.has(conn.fromNodeKey)).toBe(true);
      expect(nodeKeys.has(conn.toNodeKey)).toBe(true);
    }

    expect(parsed.connections.filter((c) => c.backward)).toHaveLength(1);
    expect(parsed.connections.find((c) => c.backward)).toMatchObject({ fromNodeKey: "engine:E07", toNodeKey: "engine:E01" });

    const pairs = parsed.connections.map((c) => `${c.fromNodeKey}->${c.toNodeKey}`);
    expect(new Set(pairs).size).toBe(pairs.length); // no duplicates
  });
});
