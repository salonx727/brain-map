import { describe, expect, it } from "vitest";
import { extractConnections } from "@/lib/coyote/extractors/connections";
import type { EngineNode, FieldValue, SourceMeta } from "@/lib/types/canonicalNode";

const sourceMeta: SourceMeta = { fileName: "fixture.md", resolvedAt: "2026-09-03T00:00:00.000Z" };
const PRESENT_STUB: FieldValue = { state: "present", value: "x" };

const DISCONNECTED: FieldValue = { state: "disconnected", expectedAnchor: "x" };

function engine(nodeKey: string, label: string, downstream: FieldValue, overrides: Partial<EngineNode> = {}): EngineNode {
  return {
    nodeKey,
    kind: "engine",
    label,
    canonRefs: [{ type: "section", value: "§35" }],
    sourceMeta,
    trigger: PRESENT_STUB,
    reads: PRESENT_STUB,
    writes: PRESENT_STUB,
    downstream,
    emits: DISCONNECTED,
    blockers: [],
    openQuestions: [],
    ...overrides,
  };
}

describe("extractConnections", () => {
  it("adds the E07 -> E01 backward edge whenever both engines are present, marked backward", () => {
    const nodes = [engine("engine:E01", "E01 — Ghost Notes", { state: "disconnected", expectedAnchor: "x" }), engine("engine:E07", "E07 — Afterburner", { state: "disconnected", expectedAnchor: "x" })];
    const { connections, diagnostics } = extractConnections(nodes);
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ fromNodeKey: "engine:E07", toNodeKey: "engine:E01", backward: true, type: "data_flow", directed: true });
    expect(diagnostics).toHaveLength(0);
  });

  it("resolves a single unambiguous DOWNSTREAM target to an edge", () => {
    const nodes = [engine("engine:E02", "E02 — Empire", { state: "present", value: "NEXUS — economic layer only" }), engine("engine:E11", "E11 — Nexus", { state: "disconnected", expectedAnchor: "x" })];
    const { connections } = extractConnections(nodes);
    expect(connections.some((c) => c.fromNodeKey === "engine:E02" && c.toNodeKey === "engine:E11" && !c.backward)).toBe(true);
  });

  it("splits a middle-dot-separated DOWNSTREAM value into one edge per target, stripping parenthetical annotations", () => {
    const nodes = [
      engine("engine:E05", "E05 — Ramp", { state: "present", value: "TAG (subscribes to `ramp-copy`) · NEXUS (post activity, CVM tier)" }),
      engine("engine:E10", "E10 — Tag", { state: "disconnected", expectedAnchor: "x" }),
      engine("engine:E11", "E11 — Nexus", { state: "disconnected", expectedAnchor: "x" }),
    ];
    const { connections } = extractConnections(nodes);
    expect(connections).toHaveLength(2);
    expect(connections.map((c) => c.toNodeKey).sort()).toEqual(["engine:E10", "engine:E11"]);
  });

  it("truncates a DOWNSTREAM value at the first blank line — the confirmed extractEngines.ts runaway-capture defect", () => {
    // Mirrors E03 MUSE's real captured value: a clean one-line assertion followed by an
    // entire unrelated KPI table and prose block, because no recognized terminator label
    // immediately follows DOWNSTREAM in that engine's real §35 subsection.
    const runaway = "NEXUS — Growth Path advancement\n\n**PRODUCERS NAMED.** Some table:\n|KPI|Source|\n|retention|TAG attribution chain|\n|referral|EMPIRE ledger|\n";
    const nodes = [engine("engine:E03", "E03 — Muse", { state: "present", value: runaway }), engine("engine:E11", "E11 — Nexus", { state: "disconnected", expectedAnchor: "x" })];
    const { connections, diagnostics } = extractConnections(nodes);
    // Without truncation this would be ambiguous (TAG and EMPIRE both appear in the
    // trailing table) and produce zero edges plus a warning — truncation must recover
    // the single real edge instead.
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ fromNodeKey: "engine:E03", toNodeKey: "engine:E11" });
    expect(diagnostics).toHaveLength(0);
  });

  it("emits a diagnostic and no edge when a DOWNSTREAM target matches no known engine", () => {
    const nodes = [engine("engine:E02", "E02 — Empire", { state: "present", value: "SOME UNKNOWN THING" })];
    const { connections, diagnostics } = extractConnections(nodes);
    expect(connections).toHaveLength(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
  });

  it("emits a diagnostic and no edge when a DOWNSTREAM target matches more than one engine", () => {
    // "E03" the code and "E03 — Muse" the label both containing ambiguous overlapping
    // aliases is not realistic — this fixture forces the ambiguity directly instead.
    const nodes = [
      engine("engine:E02", "E02 — Empire", { state: "present", value: "TAG NEXUS" }), // both aliases present in one un-delimited target
      engine("engine:E10", "E10 — Tag", { state: "disconnected", expectedAnchor: "x" }),
      engine("engine:E11", "E11 — Nexus", { state: "disconnected", expectedAnchor: "x" }),
    ];
    const { connections, diagnostics } = extractConnections(nodes);
    expect(connections).toHaveLength(0);
    expect(diagnostics.some((d) => d.message.includes("matches more than one engine"))).toBe(true);
  });

  it("never emits a self-edge", () => {
    const nodes = [engine("engine:E11", "E11 — Nexus", { state: "present", value: "NEXUS" })];
    const { connections } = extractConnections(nodes);
    expect(connections).toHaveLength(0);
  });

  it("dedupes a target repeated in the same DOWNSTREAM value into one edge", () => {
    const nodes = [engine("engine:E02", "E02 — Empire", { state: "present", value: "NEXUS · NEXUS" }), engine("engine:E11", "E11 — Nexus", { state: "disconnected", expectedAnchor: "x" })];
    const { connections } = extractConnections(nodes);
    expect(connections).toHaveLength(1);
  });

  it("reads the EMITS AT SESSION CLOSE table, taking every engine in its second column", () => {
    // §35.2's real shape: payload left, "·"-separated destinations right, header row on
    // top. E01 has no DOWNSTREAM label at all, so this table is its only fan-out.
    const table = [
      "|PAYLOAD|DESTINATION|",
      "|---|---|",
      "|`session_services[]` (with `service_id`)|EMPIRE · MUSE|",
      "|`rebook_confirmed`|AFTERBURNER|",
    ].join("\n");
    const nodes = [
      engine("engine:E01", "E01 — Ghost Notes", DISCONNECTED, { emits: { state: "present", value: table } }),
      engine("engine:E02", "E02 — Empire", DISCONNECTED),
      engine("engine:E03", "E03 — Muse", DISCONNECTED),
      engine("engine:E07", "E07 — Afterburner", DISCONNECTED),
    ];
    const { connections } = extractConnections(nodes);
    for (const to of ["engine:E02", "engine:E03", "engine:E07"]) {
      expect(connections.some((c) => c.fromNodeKey === "engine:E01" && c.toNodeKey === to)).toBe(true);
    }
  });

  it("never reads the EMITS table's column heading as a destination", () => {
    const table = ["|PAYLOAD|DESTINATION|", "|---|---|", "|`x`|NEXUS|"].join("\n");
    const nodes = [
      engine("engine:E01", "E01 — Ghost Notes", DISCONNECTED, { emits: { state: "present", value: table } }),
      engine("engine:E11", "E11 — Nexus", DISCONNECTED),
    ];
    const { connections, diagnostics } = extractConnections(nodes);
    expect(connections).toHaveLength(1);
    expect(diagnostics).toHaveLength(0); // "DESTINATION" never reached the resolver
  });

  it("runs a READS edge inward, not outward — data moves toward the engine that reads it", () => {
    const nodes = [
      engine("engine:E07", "E07 — Afterburner", DISCONNECTED, { reads: { state: "present", value: "`rebook_confirmed` · TAG attribution chain · referral eligibility state" } }),
      engine("engine:E10", "E10 — Tag", DISCONNECTED),
    ];
    const { connections } = extractConnections(nodes);
    expect(connections.some((c) => c.fromNodeKey === "engine:E10" && c.toNodeKey === "engine:E07")).toBe(true);
    expect(connections.some((c) => c.fromNodeKey === "engine:E07" && c.toNodeKey === "engine:E10")).toBe(false);
  });

  it("raises no diagnostic for a READS segment that names no engine — most of them do not", () => {
    const nodes = [engine("engine:E02", "E02 — Empire", DISCONNECTED, { reads: { state: "present", value: "`session_date` · `stylist_id` · commission rate table" } })];
    const { diagnostics } = extractConnections(nodes);
    expect(diagnostics).toHaveLength(0);
  });

  it("regression: TRIGGER resolves the capitalised object but never the lowercase common noun", () => {
    // The exact pair from canon. §35.2 "Booking created" is the INT BOOKING object;
    // §35.8 "booking off a Cube share" is an ordinary word. Reading the second as an edge
    // is the false positive that kept TRIGGER unparsed until matchesAsObject existed.
    const nodes = [
      engine("engine:E01", "E01 — Ghost Notes", DISCONNECTED, { trigger: { state: "present", value: "Booking created — the brief generates at booking · session complete (dispatch)" } }),
      engine("engine:E07", "E07 — Afterburner", DISCONNECTED, { trigger: { state: "present", value: "`session-close` step 4 · stylist→stylist referral · booking off a Cube share" } }),
    ];
    const { connections } = extractConnections(nodes);
    expect(connections.some((c) => c.fromNodeKey === "intake:BOOKING" && c.toNodeKey === "engine:E01")).toBe(true);
    expect(connections.some((c) => c.toNodeKey === "engine:E07" && c.fromNodeKey === "intake:BOOKING")).toBe(false);
  });

  it("produces no connections and no diagnostics when no engines are present at all", () => {
    const { connections, diagnostics } = extractConnections([]);
    expect(connections).toHaveLength(0);
    expect(diagnostics).toHaveLength(0);
  });
});
