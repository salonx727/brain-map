import { describe, expect, it } from "vitest";
import { blockerAskDraft } from "@/lib/ai/blockerAsk";
import type { BrainNode } from "@/lib/types";

function card(over: Partial<BrainNode> = {}): BrainNode {
  return {
    id: "engine:E05",
    ref: "E05",
    shape: "box",
    x: 0,
    y: 0,
    name: "RAMP",
    sec: "§35.6",
    color: null,
    state: "UNTOUCHED",
    origin: "canon",
    subs: [],
    todos: [],
    blockers: [],
    screens: [],
    drops: [],
    ...over,
  };
}

describe("blockerAskDraft", () => {
  it("names the card and the line so the brain is not asked to guess which blocker", () => {
    const draft = blockerAskDraft(card(), {
      text: "post_confirmed tap UI must ship to mobile",
      done: false,
      sec: "§15 › Launch Blockers",
    });
    expect(draft).toContain("E05 RAMP (engine:E05)");
    expect(draft).toContain("post_confirmed tap UI must ship to mobile");
    expect(draft).toContain("Cited: §15 › Launch Blockers");
    expect(draft).toMatch(/COYOTE and the vault/i);
  });

  it("still works when the line has no citation", () => {
    const draft = blockerAskDraft(card({ ref: "SUB-1", name: "Blink", id: "pm:abc" }), {
      text: "need the dropQueue move",
      done: false,
      sec: "",
    });
    expect(draft).toContain("SUB-1 Blink (pm:abc)");
    expect(draft).not.toContain("Cited:");
  });
});
