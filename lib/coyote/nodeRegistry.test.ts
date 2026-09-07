import { describe, expect, it } from "vitest";
import { NODE_REGISTRY, matchRegistryEntries } from "@/lib/coyote/nodeRegistry";

describe("NODE_REGISTRY — intake completeness (2026-09-03 blocking prerequisite)", () => {
  it("declares INT GATE under the intake class", () => {
    const gate = NODE_REGISTRY.find((e) => e.nodeKey === "intake:GATE");
    expect(gate).toBeDefined();
    expect(gate?.kind).toBe("intake");
    expect(gate?.implemented).toBe(true);
  });

  it("declares INT BOOKING under the intake class", () => {
    const booking = NODE_REGISTRY.find((e) => e.nodeKey === "intake:BOOKING");
    expect(booking).toBeDefined();
    expect(booking?.kind).toBe("intake");
    expect(booking?.implemented).toBe(true);
  });

  it("has no duplicate node keys across the whole registry", () => {
    const keys = NODE_REGISTRY.map((e) => e.nodeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every implemented entry's node key matches the stable kind:CODE shape", () => {
    for (const entry of NODE_REGISTRY.filter((e) => e.implemented)) {
      expect(entry.nodeKey).toMatch(/^[a-z]+:[A-Za-z0-9_]+$/);
    }
  });

  it("resolves BOOKING prose to the intake:BOOKING entry", () => {
    const matches = matchRegistryEntries("The INT BOOKING object triggers GHOST NOTES on arrival.");
    expect(matches.map((m) => m.nodeKey)).toContain("intake:BOOKING");
  });

  it("resolves THE GATE prose to the intake:GATE entry", () => {
    const matches = matchRegistryEntries("THE GATE holds imported data until commit.");
    expect(matches.map((m) => m.nodeKey)).toContain("intake:GATE");
  });
});
