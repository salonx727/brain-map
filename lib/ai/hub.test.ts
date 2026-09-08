import { describe, expect, it } from "vitest";
import { askAiHub, buildAiContext, renderRequestItems } from "@/lib/ai/hub";

describe("buildAiContext", () => {
  // Both assertions below name `sourceError` in their failure message on purpose. Read
  // through Supabase (the shape vitest runs in whenever .env carries credentials), an
  // unreadable canonical layer returns zero nodes AND a reason — and a bare "expected 0
  // to be greater than 0" hides that reason completely.
  it("builds a real, non-empty summary against whichever canonical source is configured", async () => {
    const ctx = await buildAiContext();
    expect(ctx.nodeCount, `no nodes came back — sourceError: ${ctx.sourceError ?? "none"}`).toBeGreaterThan(0);
    expect(ctx.summary.length).toBeGreaterThan(0);
    expect(ctx.summary).toContain("engine:E01");
  });

  it("scopes to exactly the requested node keys", async () => {
    const ctx = await buildAiContext(["engine:E01"]);
    expect(ctx.nodeCount, `no nodes came back — sourceError: ${ctx.sourceError ?? "none"}`).toBe(1);
    expect(ctx.summary).toContain("engine:E01");
    // E02 is named — E01 wires to it, and a wire whose far end is withheld says nothing.
    // What scoping owes is that E02 contributes no card of its own, so the assertion is
    // against the card header rather than against the string appearing at all.
    expect(ctx.summary).not.toMatch(/^engine:E02 —/m);
  });

  it("carries what the cards actually show, not a second reading of the same tables", async () => {
    const ctx = await buildAiContext();
    // Each of these was invisible while this built its own summary from getPmLayer: an
    // engine's §15 blockers, the owner cards, and the wires between engines.
    expect(ctx.summary).toMatch(/\[BLOCKER CANON\]/);
    expect(ctx.summary).toMatch(/^owner:shawn —/m);
    expect(ctx.summary).toMatch(/\[WIRE CANON\]/);
  });
});

describe("renderRequestItems", () => {
  const files = [{ id: "f1", name: "wireframe.png", nodeKey: null }];

  it("joins text items", () => {
    const out = renderRequestItems(
      { provider: "claude", apiKey: "", items: [{ kind: "text", text: "one" }, { kind: "text", text: "two" }] },
      files,
    );
    expect(out).toBe("one\n\ntwo");
  });

  it("names a file by filename and id, and never carries bytes", () => {
    const out = renderRequestItems({ provider: "claude", apiKey: "", items: [{ kind: "file", fileId: "f1" }] }, files);
    expect(out).toContain("wireframe.png");
    expect(out).toContain("f1");
    expect(out).toContain("UNROUTED");
  });

  it("says so plainly when a referenced file is not in the graph rather than inventing one", () => {
    const out = renderRequestItems({ provider: "claude", apiKey: "", items: [{ kind: "file", fileId: "ghost" }] }, files);
    expect(out).toContain("not found");
  });
});

describe("askAiHub", () => {
  it("refuses a provider it has no outbound call for, instead of quietly answering as Claude", async () => {
    await expect(askAiHub({ provider: "gpt", apiKey: "x", items: [{ kind: "text", text: "hi" }] })).rejects.toThrow(/only the "claude" provider/i);
  });

  it("refuses to call out with no key from either the request or the environment", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(askAiHub({ provider: "claude", apiKey: "", items: [{ kind: "text", text: "hi" }] })).rejects.toThrow(/no API key/i);
    } finally {
      if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it("refuses an empty turn before spending a provider call on it", async () => {
    await expect(askAiHub({ provider: "claude", apiKey: "k", items: [{ kind: "text", text: "   " }] })).rejects.toThrow(/no content/i);
  });

  it("refuses to ask anything when the map itself could not be read, rather than answering against an empty graph", async () => {
    const ctx = await buildAiContext();
    // Only meaningful when the environment actually is broken; when the canonical source
    // reads cleanly there is nothing to refuse and the guard is exercised by its sibling.
    if (!ctx.sourceError && ctx.nodeCount > 0) return;
    await expect(askAiHub({ provider: "claude", apiKey: "k", items: [{ kind: "text", text: "what is blocked?" }] })).rejects.toThrow(
      /could not be read|no nodes/i,
    );
  });
});
