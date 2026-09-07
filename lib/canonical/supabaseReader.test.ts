// Tests the pure row-mapping functions only — no live Supabase project exists yet, so
// fetchCanonicalGraphFromSupabase()'s actual queries are not exercised here. See the
// implementation report's remaining-blockers section. What IS verified: a real round
// trip through publisher.ts's own row-shaping functions, not two mirrors asserted
// independently — if either side drifts, this test catches it.

import { describe, expect, it } from "vitest";
import { toConnectionRow, toNodeRow } from "@/lib/canonical/publisher";
import { connectionRowToCanonicalConnection, nodeRowToCanonicalNode } from "@/lib/canonical/supabaseReader";
import type { CanonicalConnection, EngineNode, IntakeNode } from "@/lib/types/canonicalNode";

describe("supabaseReader row mapping — round trip against publisher.ts", () => {
  it("round-trips an intake node exactly", () => {
    const original: IntakeNode = {
      nodeKey: "intake:BOOKING",
      kind: "intake",
      label: "INT BOOKING — Booking",
      canonRefs: [{ type: "section", value: "§39" }],
      sourceMeta: { fileName: "fixture.md", resolvedAt: "2026-09-03T00:00:00.000Z" },
      definition: { state: "present", value: "## §39 — BOOKING" },
    };
    const row = toNodeRow(original);
    expect(nodeRowToCanonicalNode(row)).toEqual(original);
  });

  it("round-trips an engine node exactly, including nested blockers/openQuestions", () => {
    const original: EngineNode = {
      nodeKey: "engine:E01",
      kind: "engine",
      label: "E01 — Ghost Notes",
      canonRefs: [{ type: "section", value: "§35.2" }],
      sourceMeta: { fileName: "fixture.md", resolvedAt: "2026-09-03T00:00:00.000Z" },
      trigger: { state: "present", value: "x" },
      reads: { state: "empty" },
      writes: { state: "present", value: "y" },
      downstream: { state: "disconnected", expectedAnchor: "§35.2 DOWNSTREAM" },
      emits: { state: "present", value: "|`rebook_confirmed`|AFTERBURNER|" },
      blockers: [{ text: "b1", sourceSection: "§15", confidence: "matched", nodeKey: "engine:E01" }],
      openQuestions: [],
    };
    const row = toNodeRow(original);
    expect(nodeRowToCanonicalNode(row)).toEqual(original);
  });

  it("round-trips a connection exactly", () => {
    const original: CanonicalConnection = {
      fromNodeKey: "intake:BOOKING",
      toNodeKey: "engine:E01",
      type: "data_flow",
      directed: true,
      backward: false,
      declaringCitation: "§35.2 TRIGGER — booking confirmed",
    };
    const row = toConnectionRow(original);
    expect(connectionRowToCanonicalConnection(row)).toEqual(original);
  });
});
