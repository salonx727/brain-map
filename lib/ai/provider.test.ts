import { describe, expect, it } from "vitest";
import { AI_TOOLS, buildRequestBody, parseProviderReply, toolUseToProposal } from "@/lib/ai/provider";

describe("AI_TOOLS", () => {
  it("declares only propose_* tools — nothing the model calls can name a write", () => {
    expect(AI_TOOLS.length).toBeGreaterThan(0);
    for (const tool of AI_TOOLS) {
      expect(tool.name.startsWith("propose_")).toBe(true);
    }
  });

  it("requires a reason on every tool, so no proposal can reach an approval prompt unexplained", () => {
    for (const tool of AI_TOOLS) {
      expect(tool.input_schema.required).toContain("reason");
    }
  });
});

describe("buildRequestBody", () => {
  it("passes the graph as user-turn data, not as system instructions", () => {
    const body = buildRequestBody("engine:E01 — GHOST NOTES", "what is blocked?", "test-model");
    expect(body.model).toBe("test-model");
    expect(body.system).not.toContain("GHOST NOTES");
    expect(body.messages[0].content).toContain("GHOST NOTES");
    expect(body.messages[0].content).toContain("what is blocked?");
  });
});

describe("toolUseToProposal", () => {
  it("maps a well-formed add_item call", () => {
    const p = toolUseToProposal("propose_add_item", {
      item_kind: "todo",
      node_key: "engine:E01",
      title: "Wire the producer",
      reason: "Named in the blockers list.",
    });
    expect(p).toEqual({ kind: "add_item", itemKind: "todo", nodeKey: "engine:E01", title: "Wire the producer", reason: "Named in the blockers list." });
  });

  it("treats a missing node_key as unattached rather than failing", () => {
    const p = toolUseToProposal("propose_add_item", { item_kind: "blocker", title: "x", reason: "y" });
    expect(p).toMatchObject({ kind: "add_item", nodeKey: null });
  });

  it("rejects a call with no reason", () => {
    expect(toolUseToProposal("propose_add_item", { item_kind: "todo", title: "x" })).toBeNull();
  });

  it("rejects an item kind outside the schema instead of coercing it", () => {
    expect(toolUseToProposal("propose_add_item", { item_kind: "epic", title: "x", reason: "y" })).toBeNull();
  });

  it("rejects an unknown work state", () => {
    expect(toolUseToProposal("propose_set_node_state", { node_key: "engine:E01", state: "SHIPPED", reason: "y" })).toBeNull();
  });

  it("rejects a self-link", () => {
    expect(toolUseToProposal("propose_create_link", { from_node_key: "a", to_node_key: "a", reason: "y" })).toBeNull();
  });

  it("rejects a tool it does not know", () => {
    expect(toolUseToProposal("delete_everything", { reason: "y" })).toBeNull();
  });
});

describe("parseProviderReply", () => {
  it("splits prose from proposals", () => {
    const parsed = parseProviderReply({
      content: [
        { type: "text", text: "Two things stand out." },
        { type: "tool_use", name: "propose_set_node_state", input: { node_key: "engine:E01", state: "BLOCKED", reason: "It has an open blocker." } },
      ],
    });
    expect(parsed.answer).toBe("Two things stand out.");
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.discarded).toBe(0);
  });

  it("counts malformed tool calls instead of passing them through", () => {
    const parsed = parseProviderReply({
      content: [{ type: "tool_use", name: "propose_add_item", input: { title: "no reason given" } }],
    });
    expect(parsed.proposals).toHaveLength(0);
    expect(parsed.discarded).toBe(1);
  });

  it("handles a reply with no content at all", () => {
    const parsed = parseProviderReply({});
    expect(parsed.answer).toBe("");
    expect(parsed.proposals).toEqual([]);
  });
});
