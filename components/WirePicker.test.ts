import { describe, expect, it } from "vitest";
import { optionsFromModel } from "./WirePicker";
import type { BrainNode } from "@/lib/types";

function node(id: string, origin: BrainNode["origin"], ref = id, name = ""): BrainNode {
  return {
    id,
    ref,
    shape: "box",
    x: 0,
    y: 0,
    name,
    sec: "",
    color: null,
    state: "UNTOUCHED",
    origin,
    subs: [],
    todos: [],
    blockers: [],
    screens: [],
    drops: [],
  };
}

describe("optionsFromModel", () => {
  const nodes = {
    "engine:E01": node("engine:E01", "canon", "E01", "Drop"),
    "engine:E02": node("engine:E02", "canon", "E02", "Muse"),
    "owner:shawn": node("owner:shawn", "canon", "SHAWN", "Shawn"),
    "pm:1": node("pm:1", "user", "SUB-1", "New card"),
  };
  const order = Object.keys(nodes);

  it("lists every other card, including owners and PM cards", () => {
    const opts = optionsFromModel(nodes, order, "engine:E01", () => false);
    expect(opts.map((o) => o.id).sort()).toEqual(["engine:E02", "owner:shawn", "pm:1"]);
  });

  it("blocks engine-to-engine (COYOTE) but not engine-to-owner or engine-to-PM", () => {
    const opts = optionsFromModel(nodes, order, "engine:E01", () => false);
    expect(opts.find((o) => o.id === "engine:E02")?.disabled).toBe(true);
    expect(opts.find((o) => o.id === "owner:shawn")?.disabled).toBe(false);
    expect(opts.find((o) => o.id === "pm:1")?.disabled).toBe(false);
  });

  it("marks already-wired cards without dropping them from the list", () => {
    const opts = optionsFromModel(nodes, order, "engine:E01", (id) => id === "pm:1");
    const pm = opts.find((o) => o.id === "pm:1");
    expect(pm?.disabled).toBe(true);
    expect(pm?.reason).toBe("WIRED");
  });
});
